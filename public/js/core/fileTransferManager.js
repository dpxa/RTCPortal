import { statsService } from "../services/statsService.js";
import { historyService } from "../services/historyService.js";
import {
  SLICE_SIZE,
  DATA_CHANNEL_BUFFER_MAX_RETRIES,
  DATA_CHANNEL_BUFFER_RETRY_INTERVAL_MS,
  DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT,
  RECEIVE_BUFFER_THROTTLE_THRESHOLD,
  RECEIVE_BUFFER_RESUME_THRESHOLD,
  DEFAULT_SEND_RATE_LIMIT_BYTES_PER_SEC,
  MAX_RECEIVE_BATCH_SIZE,
  CONNECTION_TIMEOUT,
  TRANSFER_CLEANUP_DELAY,
  TRANSFER_PAUSE_POLL_INTERVAL,
  CONNECTION_RESET_DELAY,
  DOWNLOAD_BLOB_URL_REVOKE_DELAY,
  UI_UPDATE_INTERVAL,
} from "../config/constants.js";
import { appUtils } from "../utils/commonUtils.js";
import { uiManager } from "../ui/uiManager.js";
import { webrtcManager } from "./webrtcManager.js";

// Received files are persisted in OPFS under this prefix so they survive
// page refreshes and their history entries stay downloadable until the user
// clears history.
const PERSISTED_FILE_PREFIX = "persist_";

class TokenBucket {
  constructor(bytesPerSec) {
    this._bytesPerSec = Math.max(0, Number(bytesPerSec) || 0);
    this._tokens = 0;
    this._lastRefill = Date.now();
  }

  setRate(bytesPerSec) {
    this._bytesPerSec = Math.max(0, Number(bytesPerSec) || 0);
  }

  get bytesPerSec() {
    return this._bytesPerSec;
  }

  async consume(bytesNeeded) {
    if (this._bytesPerSec <= 0) return;

    this._refill();
    bytesNeeded = Number(bytesNeeded) || 0;

    if (bytesNeeded <= this._tokens) {
      this._tokens -= bytesNeeded;
      return;
    }

    const deficit = bytesNeeded - this._tokens;
    const waitMs = Math.ceil((deficit / this._bytesPerSec) * 1000);

    if (waitMs > 0) {
      await appUtils.wait(waitMs);
    }

    this._refill();
    this._tokens = Math.max(0, this._tokens - bytesNeeded);
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this._lastRefill) / 1000;
    if (elapsed > 0) {
      this._tokens = Math.min(
        this._bytesPerSec,
        this._tokens + elapsed * this._bytesPerSec,
      );
      this._lastRefill = now;
    }
  }
}

const yieldToMain = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

class SimpleQueue {
  constructor() {
    this._items = [];
    this._head = 0;
    this._size = 0;
  }

  push(item) {
    this._items.push(item);
    this._size++;
  }

  shift() {
    if (this._size === 0) return undefined;
    const item = this._items[this._head];
    this._items[this._head] = undefined;
    this._head++;
    this._size--;

    if (
      this._head > 1024 ||
      (this._head > 100 && this._head / this._items.length > 0.5)
    ) {
      this._compact();
    }

    return item;
  }

  _compact() {
    const newSize = this._size;
    this._items = this._items.slice(this._head);
    this._head = 0;
    this._size = newSize;
  }

  get length() {
    return this._size;
  }

  clear() {
    this._items = [];
    this._head = 0;
    this._size = 0;
  }
}

class FileTransferManager {
  get webrtcManager() {
    return webrtcManager;
  }
  constructor(sendRateLimit = null) {
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.isSending = false;
    this.isReceiving = false;
    this.isStopped = false;
    this.isPaused = false;
    this.receivedCleanupTimer = null;

    this.selectedFiles = [];
    this.receivedBatch = [];

    this.activeBlobUrls = new Set();
    this.activeOpfsHandles = new Set();
    this._opfsBlobUrlHandles = new Set();
    this.opfsFileHandle = null;
    this.opfsWritable = null;
    this.opfsReady = false;

    this.pendingBatchForHistory = null;
    this.hasReceivedBatchConfirmation = false;
    this.pendingTransferStats = null;
    this.hasReportedTransferComplete = false;
    this.sentCleanupTimer = null;
    this.sentBatchProgress = [];
    this.receiveSessionId = 0;
    this.totalBytesReceived = 0;

    this.configureUIBindings();

    this.sweepOrphanedOpfsFiles();

    this.opfsCleanupInterval = setInterval(() => {
      this.sweepOrphanedOpfsFiles();
    }, 300000);

    if (sendRateLimit) {
      this.sendRateLimit = new TokenBucket(sendRateLimit);
    }
  }

  _reportTransferCompleteIfPending() {
    if (this.hasReportedTransferComplete || !this.pendingTransferStats) {
      return;
    }

    const socket = this.webrtcManager?.socket;
    if (!socket) {
      return;
    }

    socket.emit("transfer-complete", {
      fileSize: this.pendingTransferStats.fileSize,
      fileCount: this.pendingTransferStats.fileCount,
      confirmed: true,
      isSender: true,
    });
    this.hasReportedTransferComplete = true;
    this.pendingTransferStats = null;

    try {
      if (statsService) {
        statsService.requestConnectionStats({ force: true });
      }
    } catch (e) {
      console.warn("Failed to refresh stats after transfer completion", e);
    }

    // Notify WebRTC manager to handle any deferred server-initiated disconnect
    try {
      this.webrtcManager?.handleLocalTransferCompleteForPendingDisconnect?.();
    } catch (e) {
      console.warn("Failed to notify webrtc manager of transfer completion", e);
    }
  }

  async sweepOrphanedOpfsFiles() {
    try {
      const root = await navigator.storage.getDirectory();
      const removals = [];
      const activeNames = new Set(
        [...this.activeOpfsHandles].map((h) => h.name),
      );
      if (this.opfsFileHandle) activeNames.add(this.opfsFileHandle.name);

      if (this.receivedBatch) {
        for (const item of this.receivedBatch) {
          if (item.opfsHandle) activeNames.add(item.opfsHandle.name);
        }
      }

      for await (const [name] of root.entries()) {
        // Persistent downloaded files (prefix `persist_`) are kept across
        // refreshes so their history entries stay downloadable. Only delete
        // orphaned temp files, not persisted downloads.
        if (name.startsWith(PERSISTED_FILE_PREFIX)) {
          continue;
        }
        if (!activeNames.has(name)) {
          removals.push(root.removeEntry(name, { recursive: true }));
        }
      }
      await Promise.allSettled(removals);
    } catch (e) {
      console.warn("OPFS sweep failed", e);
    }
  }

  configureUIBindings() {
    uiManager.bindFileTransferHandlers({
      onFilesSelected: (files, rootFolderName) =>
        this.handleFileSelection(files, rootFolderName),
      onDirectoryHandleSelected: async (dirHandle) => {
        if (!dirHandle) return;
        const files = await this.traverseDirHandle(dirHandle, "");
        this.handleFileSelection(files, dirHandle.name);
      },
      onDrop: (event) => this.handleDrop(event),
      onSendTransfer: () => this.sendFile(),
      onPaste: (event) => this.handlePaste(event),
      onTogglePause: () => this.togglePause(),
      onStopTransfer: () => this.stopTransfer(),
    });

    uiManager.registerHistoryClearHandler(() => this.handleClearHistory());
    uiManager.registerPageExitHandler(() => this.handlePageExit());
  }

  handlePageExit() {
    if (this.opfsCleanupInterval) {
      clearInterval(this.opfsCleanupInterval);
      this.opfsCleanupInterval = null;
    }
    Promise.allSettled([
      this.cleanupAllTransfers(),
      this.revokeAllBlobUrls(),
      this.sweepOrphanedOpfsFiles(),
    ])
      .then((results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            console.error("Page-exit cleanup task failed:", result.reason);
          }
        }
      })
      .catch((error) => {
        console.error("Page-exit cleanup failed:", error);
      });
  }

  async collectFilesFromItems(items, options = {}) {
    const { rootFolderMode = "single-directory" } = options;
    const filesPromises = [];
    let rootFolderName = null;
    let directoryCount = 0;

    for (let index = 0; index < items.length; index++) {
      const item = items[index];

      if (item.webkitGetAsEntry) {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          if (entry.isDirectory) {
            directoryCount++;
            if (
              rootFolderMode === "single-item-directory" &&
              items.length === 1
            ) {
              rootFolderName = entry.name;
            } else if (rootFolderMode === "single-directory") {
              rootFolderName = entry.name;
            }
          }

          filesPromises.push(this.traverseFileTree(entry));
          continue;
        }
      }

      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          filesPromises.push(Promise.resolve([file]));
        }
      }
    }

    if (rootFolderMode === "single-directory" && directoryCount !== 1) {
      rootFolderName = null;
    }

    const fileArrays = await Promise.allSettled(filesPromises);
    return {
      files: fileArrays
        .flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        )
        .filter((file) => file),
      rootFolderName,
    };
  }

  _createDirectoryMarker(folderPath) {
    const dummyFile = new File([], "");
    dummyFile.customRelativePath = folderPath;
    dummyFile.isDirectoryMarker = true;
    return dummyFile;
  }

  _setRelativePath(file, relativePath) {
    file.customRelativePath = relativePath;
    return file;
  }

  async handlePaste(event) {
    if (uiManager.isTextInputFocused()) {
      return;
    }

    const items = event.clipboardData?.items;
    if (!items) return;

    try {
      const { files, rootFolderName } = await this.collectFilesFromItems(items);

      if (files.length > 0) {
        this.handleFileSelection(files, rootFolderName);
      }
    } catch (error) {
      console.error("Paste handling failed:", error);
      uiManager.showFileWarning("Could not parse pasted files");
    }
  }

  async handleClearHistory() {
    try {
      await this.revokeAllBlobUrls({ deletePersisted: true });
      if (typeof historyService !== "undefined") {
        await historyService
          .clearHistory()
          .catch((e) => console.warn("Failed to clear IDB history", e));
        await historyService
          .clearChatHistory()
          .catch((e) => console.warn("Failed to clear chat history", e));
      }
      uiManager.clearTransferHistoryUI();
    } catch (error) {
      console.error("Failed to clear history state:", error);
    }
  }

  async handleDrop(e) {
    try {
      const dt = e.dataTransfer;
      const items = dt.items;

      if (items) {
        const { files, rootFolderName } = await this.collectFilesFromItems(
          items,
          { rootFolderMode: "single-item-directory" },
        );
        this.handleFileSelection(files, rootFolderName);
      } else {
        this.handleFileSelection(dt.files);
      }
    } catch (error) {
      console.error("Drop handling failed:", error);
      uiManager.showFileWarning("Could not process dropped files");
    }
  }

  traverseFileTree(item, path = "") {
    return new Promise((resolve) => {
      if (item.isFile) {
        item.file(
          (file) => {
            resolve([this._setRelativePath(file, path + file.name)]);
          },
          () => resolve([]),
        );
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const entries = [];
        const readEntries = () => {
          dirReader.readEntries(
            async (result) => {
              if (result.length === 0) {
                if (entries.length === 0) {
                  resolve([
                    this._createDirectoryMarker(path + item.name + "/"),
                  ]);
                } else {
                  const promises = entries.map((entry) =>
                    this.traverseFileTree(entry, path + item.name + "/"),
                  );
                  const results = await Promise.allSettled(promises);
                  resolve(
                    results.flatMap((result) =>
                      result.status === "fulfilled" ? result.value : [],
                    ),
                  );
                }
              } else {
                entries.push(...result);
                readEntries();
              }
            },
            () => resolve([]),
          );
        };
        readEntries();
      } else {
        resolve([]);
      }
    });
  }

  async traverseDirHandle(dirHandle, path = "") {
    try {
      const entries = [];
      for await (const entry of dirHandle.values()) {
        entries.push(entry);
      }

      if (entries.length === 0) {
        return [this._createDirectoryMarker(path + dirHandle.name + "/")];
      }

      const files = await Promise.allSettled(
        entries.map(async (entry) => {
          if (entry.kind === "file") {
            const file = await entry.getFile();
            return [
              this._setRelativePath(
                file,
                path + dirHandle.name + "/" + file.name,
              ),
            ];
          }

          if (entry.kind === "directory") {
            return this.traverseDirHandle(entry, path + dirHandle.name + "/");
          }

          return [];
        }),
      );

      return files.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
    } catch (error) {
      console.error("Directory traversal failed:", error);
    }

    return [];
  }

  isDataChannelOpen() {
    const wm = this.webrtcManager;
    return wm && wm.dataChannel && wm.dataChannel.readyState === "open";
  }

  updateTransferButtonState() {
    const isEnabled =
      this.selectedFiles.length > 0 &&
      this.isDataChannelOpen() &&
      !this.isSending;
    uiManager.setFileTransferButtonEnabled(isEnabled);
  }

  formatBatchMessage(action, index, total, name) {
    return total > 1
      ? `${action} file ${index}/${total}: ${name}`
      : `${action} file: ${name}`;
  }

  getPeerDisplay(peerId) {
    return uiManager.getPeerDisplayLabel
      ? uiManager.getPeerDisplayLabel(peerId)
      : peerId;
  }

  async revokeAllBlobUrls({ deletePersisted = false } = {}) {
    this.activeBlobUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.activeBlobUrls.clear();

    const opfsRemovals = [];

    // Only delete persisted OPFS files when explicitly clearing history.
    // On page exit, leave them on disk so they survive a refresh.
    for (const handle of this._opfsBlobUrlHandles) {
      this.activeOpfsHandles.delete(handle);
      if (deletePersisted) {
        opfsRemovals.push(
          navigator.storage
            .getDirectory()
            .then((root) => root.removeEntry(handle.name, { recursive: true }))
            .catch(() => {}),
        );
      }
    }
    this._opfsBlobUrlHandles.clear();

    // When deleting persisted downloads (history clear), remove ALL persisted
    // OPFS files. On normal page exit, persist them so they survive refresh.
    if (deletePersisted) {
      try {
        const root = await navigator.storage.getDirectory();
        opfsRemovals.push(
          (async () => {
            const names = [];
            for await (const [name] of root.entries()) {
              if (name.startsWith(PERSISTED_FILE_PREFIX)) {
                names.push(name);
              }
            }
            await Promise.allSettled(
              names.map((name) => root.removeEntry(name, { recursive: true })),
            );
          })(),
        );
      } catch (error) {
        console.error("Failed to clean up persisted OPFS files:", error);
      }
    }

    if (this.activeOpfsHandles.size > 0) {
      opfsRemovals.push(
        navigator.storage
          .getDirectory()
          .then((root) =>
            Promise.allSettled(
              [...this.activeOpfsHandles].map((handle) =>
                deletePersisted
                  ? root.removeEntry(handle.name) // already fully cleared above
                  : Promise.resolve(),
              ),
            ),
          )
          .catch((error) => {
            console.error("Failed to clean up OPFS history files:", error);
          })
          .finally(() => {
            this.activeOpfsHandles.clear();
          }),
      );
    }

    await Promise.allSettled(opfsRemovals);
  }

  clearFileSelectionUI() {
    this.selectedFiles = [];
    this.rootDirectoryName = null;
    uiManager.setFileSelectionSummary("");
    uiManager.setFileTransferButtonEnabled(false);
    this.resetInputFields();
  }

  resetInputFields() {
    uiManager.clearFileInputs();
  }

  handleFileSelection(files, rootFolderName = null) {
    if (!files || files.length === 0) {
      this.clearFileSelectionUI();
      return;
    }

    const fileArray = Array.from(files);
    const totalSize = fileArray.reduce((acc, file) => acc + file.size, 0);
    const MAX_SIZE = 2 * 1024 * 1024 * 1024;

    if (totalSize > MAX_SIZE) {
      uiManager.showFileWarning(
        `Total transfer size exceeds 2GB limit (${appUtils.formatBytes(totalSize)}). Please select fewer files`,
      );
      this.clearFileSelectionUI();
      return;
    }

    this.selectedFiles = fileArray;
    this.rootDirectoryName = rootFolderName;
    this.updateFileNameDisplay(totalSize);
    this.updateTransferButtonState();
    this.resetInputFields();
  }

  _queueReceivedBatchHistory(statusSuffix = null) {
    if (!this.receivedBatch || this.receivedBatch.length === 0) {
      return;
    }

    const options = statusSuffix ? { statusSuffix } : {};
    this.createBatchHistoryUI(
      [...this.receivedBatch],
      "from",
      this.receivedBatchRootName,
      options,
    );
    this.receivedBatch = [];
  }

  _shouldAbortTransfer() {
    return !this.isSending || this.isStopped || !this.isDataChannelOpen();
  }

  async _waitForTransferResume({ visibleInterval, hiddenInterval }) {
    // If paused due to ICE failure, wait up to CONNECTION_TIMEOUT for recovery.
    // After that, abort the transfer rather than hanging indefinitely.
    const isIcePause = this.isPaused && !this.isStopped;
    const deadline = isIcePause ? Date.now() + CONNECTION_TIMEOUT : Infinity;
    while (this.isPaused || this.isAutoThrottled) {
      if (this._shouldAbortTransfer()) {
        return false;
      }
      if (isIcePause && Date.now() > deadline) {
        console.warn("ICE recovery timed out, aborting transfer");
        this.isStopped = true;
        return false;
      }

      await appUtils.wait(
        appUtils.isPageHidden() ? hiddenInterval : visibleInterval,
      );
    }

    return !this._shouldAbortTransfer();
  }

  updateFileNameDisplay(totalSize) {
    const summary = this.rootDirectoryName
      ? (() => {
          const fileCount = this.selectedFiles.filter(
            (f) => !f.isDirectoryMarker,
          ).length;
          return `Selected Folder: ${this.rootDirectoryName} (${fileCount} file${fileCount !== 1 ? "s" : ""}, ${appUtils.formatBytes(totalSize)})`;
        })()
      : this.selectedFiles.length === 1
        ? `Selected: ${this.selectedFiles[0].name} (${appUtils.formatBytes(this.selectedFiles[0].size)})`
        : `Selected: ${this.selectedFiles.length} files (${appUtils.formatBytes(totalSize)})`;

    uiManager.setFileSelectionSummary(summary);
  }

  async sendFile() {
    try {
      if (!this.isDataChannelOpen()) {
        setTimeout(() => {
          if (this.webrtcManager) this.webrtcManager.resetCurrentConnection();
        }, CONNECTION_RESET_DELAY);
        return;
      }

      if (this.isSending) {
        uiManager.showFileWarning("A transfer is already in progress");
        return;
      }

      if (this.selectedFiles.length === 0) {
        uiManager.showFileAlert("No file selected");
        return;
      }

      uiManager.clearFileAlert();
      uiManager.setFileTransferButtonEnabled(false);
      this.hasReceivedBatchConfirmation = false;

      await yieldToMain();

      const totalBatchSize = this.selectedFiles.reduce(
        (acc, file) => acc + file.size,
        0,
      );
      const totalTransferredFiles = this.selectedFiles.filter(
        (file) => !file.isDirectoryMarker,
      ).length;
      this.pendingTransferStats = {
        fileSize: totalBatchSize,
        fileCount: totalTransferredFiles,
      };
      this.hasReportedTransferComplete = false;
      this.sentBatchProgress = [];
      let totalBytesSent = 0;
      this._batchStartTime = Date.now();

      let lastLoopYieldAndUI = Date.now();

      for (let i = 0; i < this.selectedFiles.length; i++) {
        if (this.isStopped) break;

        const fileToSend = this.selectedFiles[i];

        uiManager.ensureSentContainer();

        if (i === 0) {
          this._sendSpeedCtx = null;
          this.lastSentUIUpdate = 0;
          uiManager.resetSentProgressOnly();
          uiManager.updateSentStats("-", "-");
        }

        const currentFileName =
          fileToSend.customRelativePath ||
          fileToSend.webkitRelativePath ||
          fileToSend.name;

        this.currentSendStatus = this.formatBatchMessage(
          "Sending",
          i + 1,
          this.selectedFiles.length,
          currentFileName,
        );

        uiManager.setSentStatus(this.currentSendStatus);

        const nowMs = Date.now();
        if (i === 0 || nowMs - lastLoopYieldAndUI > 100) {
          await yieldToMain();
          lastLoopYieldAndUI = Date.now();
        }

        let fileHash = null;
        if (
          !fileToSend.isDirectoryMarker &&
          fileToSend.size > 0 &&
          fileToSend.size <= 50 * 1024 * 1024
        ) {
          fileHash = await appUtils.sha256Blob(fileToSend);
        }

        if (!this.isDataChannelOpen()) {
          throw new Error("Data channel closed before send");
        }
        webrtcManager.dataChannel.send(
          JSON.stringify({
            type: "metadata",
            fileName: currentFileName,
            fileSize: fileToSend.size,
            lastModified: fileToSend.lastModified ?? Date.now(),
            batchIndex: i + 1,
            batchTotal: this.selectedFiles.length,
            totalBatchSize,
            isDirectoryMarker: fileToSend.isDirectoryMarker || false,
            rootDirectoryName: this.rootDirectoryName || null,
            sha256: fileHash,
          }),
        );

        // Reset resume offset for each new file — it must not carry
        // over from a previous file in the batch.
        this._resumeOffset = null;

        try {
          await this.sendFileSlicesPromise(
            fileToSend,
            i + 1,
            this.selectedFiles.length,
            totalBatchSize,
            totalBytesSent,
            this._batchStartTime,
          );
        } catch (err) {
          // sendFileSlicesPromise already called cleanupSentTransfer()
          // internally — just update state and return.
          console.warn("Transfer aborted or failed:", err);
          this.isSending = false;
          this.isStopped = false;
          this.isPaused = false;
          this.updateTransferButtonState();
          return;
        }

        if (this.isStopped) break;

        this.sentBatchProgress.push(
          this._buildTransferHistoryEntry(fileToSend),
        );
        totalBytesSent += fileToSend.size;
      }

      const wasStopped = this.isStopped;

      this.isStopped = false;
      this.isPaused = false;

      if (this.selectedFiles.length === 0 || wasStopped) {
        this.updateTransferButtonState();
      } else {
        uiManager.setFileTransferButtonEnabled(false);

        const batchForHistory = this.selectedFiles.map((file) =>
          this._buildTransferHistoryEntry(file),
        );

        const batchDisplayName = this._getBatchDisplayName(
          this.rootDirectoryName,
          this.selectedFiles,
        );

        if (this.hasReceivedBatchConfirmation) {
          this._showSentCompleteAndFinalize(batchForHistory);
        } else {
          uiManager.setSentStatus(
            `Waiting for receiver confirmation: ${batchDisplayName}`,
          );
          this.pendingBatchForHistory = {
            batch: batchForHistory,
            direction: "to",
            rootDirectoryName: this.rootDirectoryName,
          };
          this._batchConfirmationTimer = setTimeout(() => {
            if (this.pendingBatchForHistory) {
              console.warn(
                "Receiver confirmation timed out, finalizing anyway",
              );
              this._showSentCompleteAndFinalize(
                this.pendingBatchForHistory.batch,
              );
              this.pendingBatchForHistory = null;
            }
          }, 30000);
        }
      }
    } catch (error) {
      console.error("Unexpected send pipeline failure:", error);
      uiManager.showFileWarning("Transfer failed unexpectedly");
      this.cleanupSentTransfer();
    }
  }

  finalizeSentBatchForHistory(batch, direction, rootDirectoryName) {
    if (this._pendingSentCompleteTimer) {
      clearTimeout(this._pendingSentCompleteTimer);
      this._pendingSentCompleteTimer = null;
    }
    if (this._batchConfirmationTimer) {
      clearTimeout(this._batchConfirmationTimer);
      this._batchConfirmationTimer = null;
    }
    this.createBatchHistoryUI(batch, direction, rootDirectoryName);
    uiManager.resetSentTransferUI();
    this.hasReceivedBatchConfirmation = false;
    this.pendingBatchForHistory = null;
    this.sentBatchProgress = [];
    this.updateTransferButtonState();
  }

  _buildTransferHistoryEntry(file) {
    return {
      name: file.customRelativePath || file.webkitRelativePath || file.name,
      size: file.size,
      isDirectoryMarker: file.isDirectoryMarker || false,
      lastModified: file.lastModified ?? Date.now(),
    };
  }

  _getBatchDisplayName(rootName, files) {
    return (
      rootName ||
      (files.length === 1
        ? files[0].customRelativePath || files[0].name
        : `${files.length} files`)
    );
  }

  _showSentCompleteAndFinalize(batchForHistory) {
    const batchDisplayName = this._getBatchDisplayName(
      this.rootDirectoryName,
      this.selectedFiles,
    );

    uiManager.showSentCompleteState(batchDisplayName);

    if (this._pendingSentCompleteTimer) {
      clearTimeout(this._pendingSentCompleteTimer);
    }
    this._pendingSentCompleteTimer = setTimeout(() => {
      this._pendingSentCompleteTimer = null;
      this.finalizeSentBatchForHistory(
        batchForHistory,
        "to",
        this.rootDirectoryName,
      );
    }, 500);
  }

  _renderIncompleteSentHistoryIfNeeded(statusSuffix = "Incomplete") {
    if (
      !Array.isArray(this.sentBatchProgress) ||
      this.sentBatchProgress.length === 0
    ) {
      return;
    }

    this.createBatchHistoryUI(
      [...this.sentBatchProgress],
      "to",
      this.rootDirectoryName,
      { statusSuffix },
    );
    this.sentBatchProgress = [];
  }

  togglePause() {
    if (!this.isSending && !this.isReceiving) return;
    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      if (this.isSending) {
        this.currentPauseStartSent = Date.now();
      }
      if (this.isReceiving) {
        this.currentPauseStartReceived = Date.now();
      }
      if (this.isDataChannelOpen()) {
        webrtcManager.sendControlMessage({ type: "pause-transfer" });
      }

      uiManager.setPauseButtonLabel("Resume");
      uiManager.setSentStatus("Transfer Paused");
    } else {
      if (this.currentPauseStartSent) {
        this.totalPausedTimeSent =
          (this.totalPausedTimeSent || 0) +
          (Date.now() - this.currentPauseStartSent);
        this.currentPauseStartSent = 0;
      }
      if (this.currentPauseStartReceived) {
        this.totalPausedTimeReceived =
          (this.totalPausedTimeReceived || 0) +
          (Date.now() - this.currentPauseStartReceived);
        this.currentPauseStartReceived = 0;
      }

      this._sendSpeedCtx = null;
      this._recvSpeedCtx = null;
      this._batchStartTime = Date.now();
      this.receivedBatchStartTime = Date.now();
      this.lastSentUIUpdate = 0;
      this.lastReceivedUIUpdate = 0;

      if (this.isDataChannelOpen()) {
        webrtcManager.sendControlMessage({ type: "resume-transfer" });
      }

      uiManager.setPauseButtonLabel("Pause");
      uiManager.setSentStatus(this.currentSendStatus || "Sending...");
      if (this.isSending) {
        uiManager.updateSentStats("-", "-");
      }
      if (this.isReceiving) {
        uiManager.updateReceivedStats("-", "-");
      }
    }
  }

  stopTransfer() {
    this.isStopped = true;
    this.isPaused = false;

    if (this.isDataChannelOpen()) {
      webrtcManager.sendControlMessage({ type: "cancel-transfer" });
    }

    this._renderIncompleteSentHistoryIfNeeded("Incomplete");

    uiManager.updateSentStats("-", "-");

    uiManager.resetSentTransferUI();

    if (this._stopDoneResolve) {
      this._stopDoneResolve();
      this._stopDoneResolve = null;
      this._stopDonePromise = null;
    }

    this.isSending = false;
    this.isAutoThrottled = false;
    this.updateTransferButtonState();
  }

  async waitForWebRTCBuffer() {
    const channel = webrtcManager?.dataChannel;
    if (!channel || channel.readyState !== "open") {
      return;
    }

    let bufferRetries = 0;

    while (
      channel.readyState === "open" &&
      channel.bufferedAmount > DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT &&
      bufferRetries++ < DATA_CHANNEL_BUFFER_MAX_RETRIES
    ) {
      await new Promise((resolve) => {
        let settled = false;

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timerId);
          channel.removeEventListener("bufferedamountlow", onEvent);
          channel.removeEventListener("close", onEvent);
          channel.removeEventListener("error", onEvent);
          resolve();
        };

        const onEvent = () => {
          finish();
        };

        const timerId = setTimeout(() => {
          finish();
        }, DATA_CHANNEL_BUFFER_RETRY_INTERVAL_MS);

        channel.addEventListener("bufferedamountlow", onEvent);
        channel.addEventListener("close", onEvent);
        channel.addEventListener("error", onEvent);
      });
    }
  }

  _isValidMetadataPayload(metadata) {
    const MAX_RECEIVE_FILE_SIZE = 2 * 1024 * 1024 * 1024;
    const MAX_BATCH_ITEMS = 10000;

    if (!metadata || metadata.type !== "metadata") {
      return false;
    }

    const fileNameIsValid =
      typeof metadata.fileName === "string" &&
      metadata.fileName.trim().length > 0 &&
      metadata.fileName.length <= 1024 &&
      !metadata.fileName.includes("..") &&
      !metadata.fileName.includes("\0") &&
      !metadata.fileName.startsWith("/") &&
      !metadata.fileName.startsWith("\\");
    const fileSizeIsValid =
      Number.isFinite(metadata.fileSize) &&
      metadata.fileSize >= 0 &&
      metadata.fileSize <= MAX_RECEIVE_FILE_SIZE;
    const batchIndexIsValid =
      Number.isInteger(metadata.batchIndex) && metadata.batchIndex >= 1;
    const batchTotalIsValid =
      Number.isInteger(metadata.batchTotal) &&
      metadata.batchTotal >= metadata.batchIndex &&
      metadata.batchTotal <= MAX_BATCH_ITEMS;
    const sha256IsValid =
      metadata.sha256 === null ||
      metadata.sha256 === undefined ||
      (typeof metadata.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(metadata.sha256));
    const totalBatchSizeIsValid =
      metadata.totalBatchSize === null ||
      metadata.totalBatchSize === undefined ||
      (Number.isFinite(metadata.totalBatchSize) &&
        metadata.totalBatchSize >= 0 &&
        metadata.totalBatchSize <= MAX_RECEIVE_BATCH_SIZE);

    return (
      fileNameIsValid &&
      fileSizeIsValid &&
      batchIndexIsValid &&
      batchTotalIsValid &&
      sha256IsValid &&
      totalBatchSizeIsValid
    );
  }

  async sendFileSlicesPromise(
    fileObj,
    currentIdx,
    totalCount,
    totalBatchSize,
    totalBytesSentStart,
    _batchStartTime,
  ) {
    if (this.isStopped) return Promise.resolve();

    this.isSending = true;
    this._stopDonePromise = null;
    this._stopDoneResolve = null;

    return new Promise((resolve, reject) => {
      (async () => {
        this._stopDonePromise = new Promise((stopResolve) => {
          this._stopDoneResolve = stopResolve;
        });

        const abortTransfer = (reason, error) => {
          console.error(reason, error || "");
          this.cleanupSentTransfer();
          reject(error || new Error(reason));
        };

        try {
          let offset = 0;
          let position = 0;
          const stream = fileObj.stream();
          const reader = stream.getReader();

          while (true) {
            if (this.isStopped || this._shouldAbortTransfer()) {
              this.cleanupSentTransfer();
              resolve();
              if (this._stopDoneResolve) this._stopDoneResolve();
              return;
            }

            if (webrtcManager && webrtcManager.peerConnection) {
              const pc = webrtcManager.peerConnection;
              if (pc.connectionState === "failed") {
                abortTransfer(
                  "Connection failed during transfer",
                  new Error("Connection failed"),
                );
                return;
              }
              if (
                pc.iceConnectionState === "failed" ||
                pc.connectionState === "disconnected"
              ) {
                this.isPaused = true;
                if (
                  this._resumeOffset === null ||
                  this._resumeOffset === undefined
                ) {
                  this._resumeOffset = offset;
                }
                console.warn(
                  "Transfer paused due to ICE failure, waiting for restart...",
                );
              }
            }

            if (this.isPaused || this.isAutoThrottled) {
              if (
                !(await this._waitForTransferResume({
                  visibleInterval: TRANSFER_PAUSE_POLL_INTERVAL,
                  hiddenInterval: 100,
                }))
              ) {
                this.cleanupSentTransfer();
                resolve();
                if (this._stopDoneResolve) this._stopDoneResolve();
                return;
              }
            }

            if (
              this._resumeOffset !== null &&
              this._resumeOffset !== undefined &&
              this._resumeOffset > position
            ) {
              // To resume, we would need to read chunks and discard them until we hit resumeOffset.
              // But since _resumeOffset is fundamentally broken by ICE failures killing the SCTP channel,
              // proper resumption needs to be implemented. For now, we skip forward in the stream.
              while (position < this._resumeOffset) {
                const { done, value } = await reader.read();
                if (done) break;
                position += value.byteLength;
              }
              offset = position;
              this._resumeOffset = null;
            }

            const { done, value } = await reader.read();

            if (done) {
              // File read complete
              if (
                currentIdx === totalCount ||
                Date.now() - this.lastSentUIUpdate > 100
              ) {
                uiManager.setSentStatus(
                  this.formatBatchMessage(
                    "Sent",
                    currentIdx,
                    totalCount,
                    fileObj.name,
                  ),
                );
                this.lastSentUIUpdate = Date.now();
              }

              if (
                webrtcManager.dataChannel &&
                webrtcManager.dataChannel.readyState === "open"
              ) {
                webrtcManager.dataChannel.send(
                  JSON.stringify({ type: "done" }),
                );
              }

              if (currentIdx === totalCount) {
                uiManager.updateSentStats("", "");
                if (typeof statsService !== "undefined" && statsService) {
                  statsService.requestConnectionStats();
                }
                this.isSending = false;
              }

              resolve();
              if (this._stopDoneResolve) this._stopDoneResolve();
              return;
            }

            // We got a chunk. We should send it in SLICE_SIZE slices if it's large.
            let chunkOffset = 0;
            while (chunkOffset < value.byteLength) {
              const slice_end = Math.min(
                chunkOffset + SLICE_SIZE,
                value.byteLength,
              );
              const chunk_slice = value.slice(chunkOffset, slice_end);
              chunkOffset += chunk_slice.byteLength;

              if (this.isPaused || this.isAutoThrottled) {
                if (
                  !(await this._waitForTransferResume({
                    visibleInterval: TRANSFER_PAUSE_POLL_INTERVAL,
                    hiddenInterval: 10,
                  }))
                ) {
                  this.cleanupSentTransfer();
                  resolve();
                  if (this._stopDoneResolve) this._stopDoneResolve();
                  return;
                }
              }

              if (this._shouldAbortTransfer()) {
                abortTransfer(
                  "Transfer aborted",
                  new Error("Transfer aborted"),
                );
                return;
              }

              await this.waitForWebRTCBuffer();
              if (this.sendRateLimit) {
                await this.sendRateLimit.consume(
                  chunk_slice.byteLength || chunk_slice.length || 0,
                );
              }

              if (
                !webrtcManager.dataChannel ||
                webrtcManager.dataChannel.readyState !== "open"
              ) {
                abortTransfer(
                  "Data channel closed during send",
                  new Error("Data channel closed"),
                );
                return;
              }

              webrtcManager.dataChannel.send(chunk_slice);
              offset += chunk_slice.byteLength;
              position += chunk_slice.byteLength;

              const now = Date.now();
              if (
                !this.lastSentUIUpdate ||
                now - this.lastSentUIUpdate > UI_UPDATE_INTERVAL ||
                (offset === fileObj.size && currentIdx === totalCount)
              ) {
                uiManager.ensureSentContainer();
                const currentTotalSent = totalBytesSentStart + offset;
                const totalSize =
                  Number(totalBatchSize) || Number(fileObj.size) || 0;
                uiManager.updateSentProgressBarValue(
                  this.calculateProgressPercent(currentTotalSent, totalSize),
                );
                const stats = this.calculateTransferStats(
                  currentTotalSent,
                  totalSize,
                  this._batchStartTime,
                  now,
                  true,
                );
                if (stats) {
                  uiManager.updateSentStats(stats.speedStr, stats.etaStr);
                }
                this.lastSentUIUpdate = Date.now();
              }
            }
          }
        } catch (err) {
          abortTransfer("File read/send error", err);
        }
      })().catch((err) => reject(err));
    });
  }

  formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "-";
    return appUtils.formatUptime(seconds * 1000);
  }

  calculateProgressPercent(bytesTransferred, totalBytes) {
    const safeTotal = Math.max(0, Number(totalBytes) || 0);
    const safeTransferred = Math.max(0, Number(bytesTransferred) || 0);

    if (safeTotal <= 0) {
      return safeTransferred > 0 ? 100 : 0;
    }

    if (safeTransferred <= 0) {
      return 0;
    }

    if (safeTransferred >= safeTotal) {
      return 100;
    }

    const rawPercent = (safeTransferred / safeTotal) * 100;
    const clampedPercent = Math.min(100, Math.max(0, rawPercent));
    return Math.floor(clampedPercent);
  }

  sendResumeOffsetSync() {
    if (this.isReceiving && this.currentFileDetails) {
      const offset = this.currentFileBytesReceived || 0;
      console.warn("Sending resume-offset-sync for offset", offset);
      if (
        webrtcManager.dataChannel &&
        webrtcManager.dataChannel.readyState === "open"
      ) {
        webrtcManager.dataChannel.send(
          JSON.stringify({ type: "resume-offset-sync", offset }),
        );
      }
    }
  }

  calculateTransferStats(
    bytesTransferred,
    totalBytes,
    startTime,
    now = Date.now(),
    isSending = true,
  ) {
    const safeBytesTransferred = Math.max(0, Number(bytesTransferred) || 0);
    const safeTotalBytes = Math.max(0, Number(totalBytes) || 0);
    const effectiveNow = Number(now) || Date.now();

    const elapsed = (effectiveNow - startTime) / 1000;

    const ctxKey = isSending ? "_sendSpeedCtx" : "_recvSpeedCtx";
    let ctx = this[ctxKey];

    if (!ctx || ctx.startTime !== startTime) {
      ctx = {
        startTime,
        lastTime: effectiveNow,
        lastBytes: safeBytesTransferred,
        currentSpeed: 0,
      };
      this[ctxKey] = ctx;
      return null;
    }

    if (elapsed < 0.5) return null;

    const deltaT = (effectiveNow - ctx.lastTime) / 1000;

    if (deltaT >= 0.2 || (elapsed >= 0.5 && ctx.currentSpeed === 0)) {
      const deltaB = Math.max(0, safeBytesTransferred - ctx.lastBytes);
      const instantSpeed = deltaT > 0 ? deltaB / deltaT : 0;

      if (ctx.currentSpeed <= 0) {
        ctx.currentSpeed = instantSpeed;
      } else {
        ctx.currentSpeed = ctx.currentSpeed * 0.65 + instantSpeed * 0.35;
      }

      ctx.lastTime = effectiveNow;
      ctx.lastBytes = safeBytesTransferred;
    }

    if (ctx.currentSpeed <= 0 && elapsed > 1.0) {
      const overallSpeed = safeBytesTransferred / elapsed;
      if (overallSpeed > 0) {
        ctx.currentSpeed = overallSpeed;
      }
    }

    if (ctx.currentSpeed <= 0) {
      return null;
    }

    const remainingBytes = Math.max(0, safeTotalBytes - safeBytesTransferred);
    const eta = remainingBytes / ctx.currentSpeed;

    return {
      speedStr: appUtils.formatBytes(ctx.currentSpeed) + "/s",
      etaStr: this.formatTime(eta),
    };
  }

  handleIncomingData(data) {
    if (!this.receiveBuffer) {
      this.receiveBuffer = new SimpleQueue();
      this.receiveBufferSize = 0;
    }
    if (data === null || data === undefined) {
      // Null is used as a "kick" to trigger processing of remaining items.
      // Don't push it onto the buffer — it would crash on byteLength access.
    } else {
      this.receiveBuffer.push(data);
      this.receiveBufferSize += data.byteLength || data.length || 0;
      if (this.receiveBufferSize > 50 * 1024 * 1024) {
        console.error(
          "Receive buffer exceeded hard limit, aborting to prevent OOM.",
        );
        this.cleanupReceivedTransfer({
          statusSuffix: "Failed - Buffer Overflow",
        }).catch(console.error);
        return;
      }
    }

    if (
      this.receiveBufferSize > RECEIVE_BUFFER_THROTTLE_THRESHOLD &&
      !this.isThrottlingSender
    ) {
      this.isThrottlingSender = true;
      if (this.webrtcManager) {
        this.webrtcManager.sendControlMessage({ type: "throttle-pause" });
      }
    }

    if (!this.isProcessingReceive) {
      this.isProcessingReceive = true;
      this._receiveProcessDepth = 0;
      Promise.resolve()
        .then(() => this.processReceiveBuffer(this.receiveSessionId))
        .catch((error) => {
          console.error("Receive buffer processing crashed:", error);
        })
        .finally(() => {
          this.isProcessingReceive = false;

          if (this.receiveBuffer?.length) {
            this._receiveProcessDepth = (this._receiveProcessDepth || 0) + 1;
            if (this._receiveProcessDepth > 10) {
              console.warn(
                "Receive buffer processing depth exceeded, yielding to prevent starvation",
              );
              this._receiveProcessDepth = 0;
              setTimeout(() => {
                this.isProcessingReceive = false;
                if (this.receiveBuffer?.length) {
                  this.handleIncomingData(null);
                }
              }, 0);
              return;
            }
            this.isProcessingReceive = true;
            Promise.resolve()
              .then(() => this.processReceiveBuffer(this.receiveSessionId))
              .catch((error) => {
                console.error("Receive buffer re-processing crashed:", error);
              })
              .finally(() => {
                this.isProcessingReceive = false;
              });
          }
        });
    }
  }

  async processReceiveBuffer(sessionId = this.receiveSessionId) {
    let processCount = 0;
    let loopStartTime = performance.now();

    while (this.receiveBuffer && this.receiveBuffer.length > 0) {
      if (sessionId !== this.receiveSessionId) {
        break;
      }

      const data = this.receiveBuffer.shift();
      this.receiveBufferSize = Math.max(
        0,
        (this.receiveBufferSize || 0) - (data.byteLength || data.length || 0),
      );

      try {
        await this._processIncomingBufferItem(data);
      } catch (error) {
        console.error("Receive buffer item processing failed:", error);
      }

      processCount++;
      if (processCount % 100 === 0) {
        this._checkThrottleResumeOnBufferLow();

        if (performance.now() - loopStartTime >= 50) {
          await yieldToMain();
          loopStartTime = performance.now();
        }
      }
    }

    this._checkThrottleResumeOnBufferLow();
  }

  async _processIncomingBufferItem(data) {
    if (typeof data === "string") {
      await this.processControlInstruction(data);
    } else {
      await this.processIncomingChunk(data);
    }
  }

  _checkThrottleResumeOnBufferLow() {
    if (
      this.isThrottlingSender &&
      this.receiveBufferSize < RECEIVE_BUFFER_RESUME_THRESHOLD
    ) {
      this.isThrottlingSender = false;
      if (this.webrtcManager) {
        this.webrtcManager.sendControlMessage({ type: "throttle-resume" });
      }
    }
  }

  async processControlInstruction(input) {
    try {
      const controlMessage = JSON.parse(input);

      switch (controlMessage.type) {
        case "metadata":
          if (!this._isValidMetadataPayload(controlMessage)) {
            throw new Error("Invalid metadata payload");
          }
          await this.handleIncomingMetadata(controlMessage);
          break;
        case "pause-transfer":
          this.handleTransferPause();
          break;
        case "resume-transfer":
          this.handleTransferResume();
          break;
        case "throttle-pause":
          this.isAutoThrottled = true;
          if (this.isSending) {
            uiManager.setSentStatus(
              "Throttled by receiver — waiting for buffer to drain...",
            );
          }
          break;
        case "throttle-resume":
          this.isAutoThrottled = false;
          if (this.isSending) {
            uiManager.setSentStatus(this.currentSendStatus || "Sending...");
          }
          break;
        case "done":
          await this.finalizeIncomingFile();
          this.isReceiving = false;
          break;

        case "batch-received":
          this._reportTransferCompleteIfPending();
          // Immediately refresh stats so the receiver's UI reflects the transfer
          try {
            if (statsService) {
              statsService.requestConnectionStats({ force: true });
            }
          } catch (e) {
            console.warn("Failed to refresh stats after batch received", e);
          }
          if (this.pendingBatchForHistory) {
            this._showSentCompleteAndFinalize(
              this.pendingBatchForHistory.batch,
            );
            this.pendingBatchForHistory = null;
          } else {
            this.hasReceivedBatchConfirmation = true;
          }
          break;
        case "cancel-transfer":
          this.handleTransferCancellation();
          break;
        default:
          console.warn("Unknown control instruction:", controlMessage.type);
      }
    } catch (error) {
      console.warn("Received malformed transfer control data.", error);
      uiManager.showFileWarning("Received malformed transfer control data");
    }
  }

  handleTransferPause() {
    // Set the paused flag so the sender (if this peer is the sender) stops
    // streaming. Harmless on the receiver, where sending is not gated on it.
    this.isPaused = true;
    this.currentPauseStartReceived = Date.now();
    uiManager.setReceivedStatus("Transfer Paused");
  }

  handleTransferResume() {
    if (this.currentPauseStartReceived) {
      this.totalPausedTimeReceived =
        (this.totalPausedTimeReceived || 0) +
        (Date.now() - this.currentPauseStartReceived);
      this.currentPauseStartReceived = 0;
    }

    this.isPaused = false;
    this._recvSpeedCtx = null;
    uiManager.updateReceivedStats("-", "-");
  }

  handleTransferCancellation() {
    this.cleanupReceivedTransfer({ statusSuffix: "Incomplete" }).catch(
      (error) => {
        console.error("Failed to cancel incoming transfer cleanly:", error);
      },
    );
    uiManager.showFileWarning("Sender cancelled transfer");
  }

  async handleIncomingMetadata(info) {
    if (this.receivedCleanupTimer) {
      clearTimeout(this.receivedCleanupTimer);
      this.receivedCleanupTimer = null;
    }

    uiManager.ensureReceivedContainer();

    if (info.batchIndex === 1) {
      // Finalize any previous incomplete batch before starting a new one.
      // Only mark as Incomplete if we were actively receiving — otherwise
      // the previous batch may have been a duplicate/spurious metadata.
      if (this.receivedBatch && this.receivedBatch.length > 0) {
        const wasActive = this.isReceiving && this.receivedFileDetails;
        this._queueReceivedBatchHistory(wasActive ? "Incomplete" : null);
      }
      this.receivedBatch = [];
      this.receivedBatchRootName = info.rootDirectoryName || null;
      this.totalBatchBytesReceived = 0;
      this.totalBytesReceived = 0;
      this.receivedBatchStartTime = Date.now();

      this.totalPausedTimeReceived = 0;
      this.currentPauseStartReceived = 0;
      this._recvSpeedCtx = null;
      this.isAutoThrottled = false;
      this.isThrottlingSender = false;

      // Reset the receive buffer to discard any stale chunks from a
      // previous batch that may still be queued.
      this.receiveBuffer = new SimpleQueue();
      this.receiveBufferSize = 0;
      this.receiveSessionId += 1;

      uiManager.resetReceivedProgressOnly();
      uiManager.updateReceivedStats("-", "-");
    }

    this.receivedFileDetails = {
      fileName: info.fileName,
      fileSize: info.fileSize,
      lastModified: info.lastModified ?? Date.now(),
      batchIndex: info.batchIndex || 1,
      batchTotal: info.batchTotal || 1,
      totalBatchSize: info.totalBatchSize ?? info.fileSize,
      isDirectoryMarker: info.isDirectoryMarker || false,
      expectedHash: info.sha256 || null,
    };

    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.isReceiving = true;
    this.isStopped = false;
    this.isAutoThrottled = false;
    this.lastReceivedUIUpdate = 0;
    this.opfsReady = false;

    uiManager.ensureReceivedContainer();
    uiManager.setReceivedStatus(
      this.formatBatchMessage(
        "Receiving",
        info.batchIndex,
        info.batchTotal,
        info.fileName,
      ),
    );

    if (!info.isDirectoryMarker) {
      await this.initializeOPFSForIncomingFile(info.fileName);
    }
  }

  async initializeOPFSForIncomingFile(fileName) {
    const chunksToWrite = this.collectedChunks;
    this.collectedChunks = [];

    try {
      const root = await navigator.storage.getDirectory();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const tempFileName = `${PERSISTED_FILE_PREFIX}${Date.now()}_${safeFileName}`;

      this.opfsFileHandle = await root.getFileHandle(tempFileName, {
        create: true,
      });
      this.opfsWritable = await this.opfsFileHandle.createWritable();

      for (const chunk of chunksToWrite) {
        await this.opfsWritable.write(chunk);
      }
      this.opfsReady = true;
    } catch (e) {
      console.error("OPFS setup failed, falling back to memory storage.", e);
      // Restore collected chunks so they are not lost when falling back
      // to in-memory storage.
      this.collectedChunks = chunksToWrite.concat(this.collectedChunks);
      this.opfsFileHandle = null;
      this.opfsWritable = null;
      this.opfsReady = false;
    }
  }

  async processIncomingChunk(arrayBuffer) {
    if (!this.receivedFileDetails) return;
    // isStopped is only set by stopTransfer (sender-side UI). On the
    // receiver, cancellation arrives via cancel-transfer control message
    // which calls cleanupReceivedTransfer directly. Checking isStopped
    // here would be redundant and could block legitimate receives.

    this.totalBytesReceived += arrayBuffer.byteLength;
    if (this.totalBytesReceived > MAX_RECEIVE_BATCH_SIZE) {
      console.error("Received data exceeds maximum batch size");
      await this.cleanupReceivedTransfer({
        statusSuffix: "Failed - Exceeded size limit",
      });
      if (this.isDataChannelOpen()) {
        webrtcManager.sendControlMessage({ type: "cancel-transfer" });
      }
      uiManager.showFileWarning(
        `Transfer aborted: received data exceeds the ${appUtils.formatBytes(MAX_RECEIVE_BATCH_SIZE)} limit`,
      );
      return;
    }

    if (this.opfsReady && this.opfsWritable) {
      try {
        await this.opfsWritable.write(arrayBuffer);
      } catch (err) {
        console.error("OPFS write error, aborting transfer:", err);
        // Abort OPFS for this file — prior chunks written to the now-deleted
        // OPFS file are irrecoverable, so falling back to in-memory would
        // produce a silently corrupted file.
        try {
          await this.opfsWritable.abort();
        } catch (_abortErr) {}
        this.opfsWritable = null;
        const name = this.opfsFileHandle?.name;
        this.opfsFileHandle = null;
        this.opfsReady = false;
        // Clean up the abandoned OPFS temp file
        if (name) {
          try {
            const root = await navigator.storage.getDirectory();
            root.removeEntry(name, { recursive: true }).catch(() => {});
          } catch (_removeErr) {}
        }
        await this.cleanupReceivedTransfer({
          statusSuffix: "Failed - Storage error",
        });
        if (this.isDataChannelOpen()) {
          webrtcManager.sendControlMessage({ type: "cancel-transfer" });
        }
        uiManager.showFileWarning(
          "Transfer aborted: file storage failed mid-transfer",
        );
        return;
      }

      if (!this.receivedFileDetails) return;
    } else {
      this.collectedChunks.push(arrayBuffer);
    }

    this.receivedBytes += arrayBuffer.byteLength;
    this.totalBatchBytesReceived += arrayBuffer.byteLength;

    // Guard against sender sending more data than declared.
    if (this.receivedBytes > this.receivedFileDetails.fileSize) {
      console.error(
        `Received more data than expected for ${this.receivedFileDetails.fileName}: ` +
          `expected ${this.receivedFileDetails.fileSize}, got ${this.receivedBytes}`,
      );
      await this.cleanupReceivedTransfer({
        statusSuffix: "Failed - Size mismatch",
      });
      if (this.isDataChannelOpen()) {
        webrtcManager.sendControlMessage({ type: "cancel-transfer" });
      }
      uiManager.showFileWarning(
        `Transfer aborted: received more data than expected for "${this.receivedFileDetails.fileName}"`,
      );
      return;
    }

    const now = Date.now();
    if (
      now - this.lastReceivedUIUpdate > UI_UPDATE_INTERVAL ||
      this.receivedBytes === this.receivedFileDetails.fileSize
    ) {
      uiManager.ensureReceivedContainer();
      uiManager.setReceivedStatus(
        this.formatBatchMessage(
          "Receiving",
          this.receivedFileDetails.batchIndex,
          this.receivedFileDetails.batchTotal,
          this.receivedFileDetails.fileName,
        ),
      );

      const totalSize = this.receivedFileDetails.totalBatchSize;
      const isFileComplete =
        this.receivedBytes === this.receivedFileDetails.fileSize;
      const isLastBatchFile =
        this.receivedFileDetails.batchIndex ===
        this.receivedFileDetails.batchTotal;

      if (isFileComplete && isLastBatchFile) {
        uiManager.setReceivedStatus(
          this.formatBatchMessage(
            "Received",
            this.receivedFileDetails.batchIndex,
            this.receivedFileDetails.batchTotal,
            this.receivedFileDetails.fileName,
          ),
        );
        uiManager.updateReceivedStats("", "");
      } else {
        const stats = this.calculateTransferStats(
          this.totalBatchBytesReceived,
          totalSize,
          this.receivedBatchStartTime,
          now,
          false,
        );
        if (stats) {
          uiManager.updateReceivedStats(stats.speedStr, stats.etaStr);
        }
      }

      uiManager.updateReceivedProgressBarValue(
        this.calculateProgressPercent(this.totalBatchBytesReceived, totalSize),
      );
      this.lastReceivedUIUpdate = now;
    }
  }

  async finalizeIncomingFile() {
    const currentWritable = this.opfsWritable;
    const currentFileHandle = this.opfsFileHandle;
    const currentDetails = this.receivedFileDetails;
    const currentChunks = this.collectedChunks;

    if (!currentDetails) {
      if (currentWritable) {
        try {
          await currentWritable.abort();
        } catch (error) {
          console.error("Failed to abort stale OPFS writer:", error);
        }
      }
      this.opfsWritable = null;
      this.opfsFileHandle = null;
      this.opfsReady = false;
      this.collectedChunks = [];
      return;
    }

    this.opfsWritable = null;
    this.opfsFileHandle = null;
    this.opfsReady = false;
    this.collectedChunks = [];

    let fileBlob = null;
    let fileHandle = null;

    if (!currentDetails.isDirectoryMarker) {
      if (currentWritable && currentFileHandle) {
        try {
          await currentWritable.close();
        } catch (err) {
          console.error("Error closing OPFS file:", err);
        }
        try {
          fileBlob = await currentFileHandle.getFile();
          fileHandle = currentFileHandle;
        } catch (getFileErr) {
          console.error(
            "Error reading OPFS file after close failure:",
            getFileErr,
          );
          // currentChunks is empty when OPFS was in use (chunks were streamed
          // to disk). Falling back to new Blob(currentChunks) would produce a
          // 0-byte file. Create a Blob with the chunks we have (if any) but
          // warn the user about potential corruption.
          fileBlob = new Blob(currentChunks);
          uiManager.showFileWarning(
            `File "${currentDetails.fileName}" may be empty or corrupted (storage finalization failed)`,
          );
        }
      } else {
        fileBlob = new Blob(currentChunks);
      }
    }

    // Verify received file size matches expected size
    if (
      !currentDetails.isDirectoryMarker &&
      currentDetails.fileSize > 0 &&
      this.receivedBytes !== currentDetails.fileSize
    ) {
      console.error(
        `File size mismatch for ${currentDetails.fileName}: expected ${currentDetails.fileSize}, received ${this.receivedBytes}`,
      );
      uiManager.showFileWarning(
        `File "${currentDetails.fileName}" may be corrupted (size mismatch: expected ${appUtils.formatBytes(currentDetails.fileSize)}, got ${appUtils.formatBytes(this.receivedBytes)})`,
      );
    }

    this.receivedBatch.push({
      name: currentDetails.fileName,
      blob: fileBlob,
      opfsHandle: fileHandle,
      isDirectoryMarker: currentDetails.isDirectoryMarker,
      lastModified: currentDetails.lastModified,
      size: currentDetails.fileSize,
    });

    if (
      currentDetails.expectedHash &&
      currentDetails.hasher &&
      !currentDetails.isDirectoryMarker
    ) {
      const computedHash = currentDetails.hasher.digest();
      if (computedHash && computedHash !== currentDetails.expectedHash) {
        console.error(
          `SHA-256 mismatch for ${currentDetails.fileName}: expected ${currentDetails.expectedHash}, got ${computedHash}`,
        );
        uiManager.showFileWarning(
          `File "${currentDetails.fileName}" may be corrupted (checksum mismatch)`,
        );
      }
    }

    if (currentDetails.batchIndex === currentDetails.batchTotal) {
      uiManager.setReceivedStatus(
        this.formatBatchMessage(
          "Received",
          currentDetails.batchIndex,
          currentDetails.batchTotal,
          currentDetails.fileName,
        ),
      );
    }

    const isLastInBatch =
      currentDetails.batchIndex === currentDetails.batchTotal;

    uiManager.updateReceivedProgressBarValue(
      this.calculateProgressPercent(
        this.totalBatchBytesReceived,
        currentDetails.totalBatchSize,
      ),
    );

    if (isLastInBatch) {
      const batchDisplayName = this._getBatchDisplayName(
        this.receivedBatchRootName,
        this.receivedBatch,
      );

      uiManager.showReceivedCompleteState(batchDisplayName);

      if (
        this.webrtcManager &&
        ((this.webrtcManager.controlChannel &&
          this.webrtcManager.controlChannel.readyState === "open") ||
          (this.webrtcManager.dataChannel &&
            this.webrtcManager.dataChannel.readyState === "open"))
      ) {
        this.webrtcManager.sendControlMessage({ type: "batch-received" });
      }

      if (statsService) {
        statsService.requestConnectionStats();
      }
      if (this.receivedCleanupTimer) {
        clearTimeout(this.receivedCleanupTimer);
      }
      this.receivedCleanupTimer = setTimeout(
        () => {
          this._queueReceivedBatchHistory();

          uiManager.resetReceivedTransferUI();
          this.totalBatchBytesReceived = 0;
          this.receivedCleanupTimer = null;
        },
        Math.max(TRANSFER_CLEANUP_DELAY, 500),
      );
    }

    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
  }

  createBatchHistoryUI(batch, direction, rootDirectoryName, options = {}) {
    const { statusSuffix = null } = options;

    if (direction === "from") {
      batch.forEach((file) => {
        if (file.opfsHandle) {
          this.activeOpfsHandles.add(file.opfsHandle);
        }
      });
    }

    const isFolderItem =
      !!rootDirectoryName ||
      batch.some((file) => file.isDirectoryMarker || file.name.includes("/"));
    const isSingleFile = batch.length === 1 && !isFolderItem;

    const singleFileDownload =
      direction === "from" && isSingleFile
        ? this._buildSingleFileDownload(batch)
        : null;

    if (direction === "from") {
      batch.forEach((file) => {
        if (file.opfsHandle && !this._opfsBlobUrlHandles.has(file.opfsHandle)) {
          this._scheduleOpfsCleanup(file.opfsHandle);
        }
      });
    }

    if (typeof historyService !== "undefined") {
      // OPFS handles are not serializable, so persist each file's OPFS
      // filename. On a later page load these names let us re-open the
      // files and rebuild working download links.
      historyService
        .addRecord({
          batch: batch.map((f) => ({
            name: f.name || f.fileName,
            size: f.size || f.fileSize,
            isDirectoryMarker: f.isDirectoryMarker,
            opfsName: f.opfsHandle?.name || null,
          })),
          direction,
          rootDirectoryName,
          statusSuffix,
          peerDisplay: this.getPeerDisplay(webrtcManager?.activePeerId),
          timestamp: Date.now(),
        })
        .catch((e) => console.warn("History save failed:", e));
    }

    uiManager.renderTransferHistoryBatch({
      batch,
      direction,
      rootDirectoryName,
      statusSuffix,
      peerDisplay: this.getPeerDisplay(webrtcManager?.activePeerId),
      singleFileDownload,
      onZipDownload: async (_button, displayName) => {
        await this.downloadSpecificBatch(batch, displayName);
      },
    });
  }

  async downloadSpecificBatch(files, defaultName) {
    if (!files || files.length === 0) return;

    try {
      const content = await this._generateZipBlob(files);
      const blobUrl = URL.createObjectURL(content);
      this.activeBlobUrls.add(blobUrl);
      uiManager.triggerDownload(
        blobUrl,
        `${defaultName.replace(/[^a-zA-Z0-9.\-_ ]/g, "_")}.zip`,
      );
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        this.activeBlobUrls.delete(blobUrl);
      }, DOWNLOAD_BLOB_URL_REVOKE_DELAY);
    } catch (e) {
      console.error("Error generating zip:", e);
      uiManager.showFileWarning(
        "Failed to create ZIP: Transfer may be too large for browser memory",
      );
    }
  }

  async _generateZipBlob(files) {
    const workerFiles = files
      .map((file) => ({
        name: file?.name,
        isDirectoryMarker: Boolean(file?.isDirectoryMarker),
        lastModified: file?.lastModified,
        blob: file?.blob || null,
      }))
      .filter((file) => typeof file.name === "string" && file.name !== "");

    if (
      typeof Worker === "undefined" ||
      !this._canUseZipWorkerPayload(workerFiles)
    ) {
      throw new Error(
        "ZIP generation requires Web Workers and valid file blobs. " +
          "Main thread fallback has been removed for performance reasons.",
      );
    }

    try {
      return await this._generateZipBlobViaWorker(workerFiles);
    } catch (error) {
      console.error("ZIP worker failed:", error);
      const message =
        error?.message && error.message !== "ZIP worker error"
          ? error.message
          : "ZIP generation failed. Please try again or download files individually.";
      throw new Error(message, { cause: error });
    }
  }

  _canUseZipWorkerPayload(workerFiles) {
    return workerFiles.every((file) => {
      if (file.isDirectoryMarker || String(file.name).endsWith("/")) {
        return true;
      }
      return file.blob instanceof Blob;
    });
  }

  async _generateZipBlobViaWorker(workerFiles) {
    return new Promise((resolve, reject) => {
      const worker = new Worker("js/workers/zipWorker.js");
      const WORKER_TIMEOUT_MS = 90000;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.terminate();
      };

      const onMessage = (event) => {
        const payload = event?.data || {};
        cleanup();

        if (payload.error) {
          reject(new Error(payload.error));
          return;
        }

        if (!(payload.blob instanceof Blob)) {
          reject(new Error("ZIP worker returned invalid payload."));
          return;
        }

        resolve(payload.blob);
      };

      const onError = (event) => {
        cleanup();
        reject(event?.error || new Error(event?.message || "ZIP worker error"));
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("ZIP worker timed out."));
      }, WORKER_TIMEOUT_MS);

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ files: workerFiles });
    });
  }

  cleanupSentTransfer() {
    if (this._pendingSentCompleteTimer) {
      clearTimeout(this._pendingSentCompleteTimer);
      this._pendingSentCompleteTimer = null;
    }
    if (this._batchConfirmationTimer) {
      clearTimeout(this._batchConfirmationTimer);
      this._batchConfirmationTimer = null;
    }
    if (this._stopDoneResolve) {
      this._stopDoneResolve();
      this._stopDoneResolve = null;
      this._stopDonePromise = null;
    }

    this._renderIncompleteSentHistoryIfNeeded("Incomplete");

    this.isSending = false;
    this.isPaused = false;
    this.isAutoThrottled = false;
    this.pendingBatchForHistory = null;
    this.hasReceivedBatchConfirmation = false;
    this.pendingTransferStats = null;
    this.hasReportedTransferComplete = false;

    if (this.sentCleanupTimer) {
      clearTimeout(this.sentCleanupTimer);
      this.sentCleanupTimer = null;
    }

    this._sendSpeedCtx = null;
    uiManager.resetSentTransferUI();
    uiManager.clearFileInputs();
    uiManager.setFileTransferButtonEnabled(false);

    this.totalPausedTimeSent = 0;
    this.currentPauseStartSent = 0;
  }

  _scheduleOpfsCleanup(_handle) {
    // Intentionally disabled. Deleting the OPFS backing file here
    // causes silent data corruption or download failures if the
    // user attempts to download the file/batch later from history.
    // OPFS cleanup is handled cleanly during revokeAllBlobUrls
    // (on page exit or history clear) and sweepOrphanedOpfsFiles.
  }

  async cleanupReceivedTransfer(options = {}) {
    const { statusSuffix = null } = options;
    const wasReceiving = this.isReceiving;

    this.isReceiving = false;
    this.isPaused = false;
    this.receiveSessionId += 1;
    this._recvSpeedCtx = null;
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receiveBuffer = new SimpleQueue();
    this.receiveBufferSize = 0;
    this.isThrottlingSender = false;
    this.receivedBytes = 0;
    this.totalBytesReceived = 0;
    this.totalBatchBytesReceived = 0;

    if (this.receivedBatch && this.receivedBatch.length > 0) {
      this._queueReceivedBatchHistory(
        statusSuffix || (wasReceiving ? "Incomplete" : null),
      );
    }

    this.totalPausedTimeReceived = 0;
    this.currentPauseStartReceived = 0;

    if (this.receivedCleanupTimer) {
      clearTimeout(this.receivedCleanupTimer);
      this.receivedCleanupTimer = null;
    }

    if (this.opfsWritable) {
      try {
        await this.opfsWritable.abort();
      } catch (error) {
        console.error("Failed to abort OPFS writer during cleanup:", error);
      }
      this.opfsWritable = null;
    }
    if (this.opfsFileHandle) {
      const name = this.opfsFileHandle.name;
      this.opfsFileHandle = null;
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(name, { recursive: true });
      } catch (error) {
        console.error("Failed to remove OPFS temp file during cleanup:", error);
      }
    }
    this.opfsReady = false;

    uiManager.resetReceivedTransferUI();
  }

  // Reopens persisted OPFS files referenced by history records and renders
  // them again, so entries restored after a page refresh still have working
  // download links. Files whose OPFS backing is gone are skipped.
  async restorePersistedHistory() {
    try {
      const root = await navigator.storage.getDirectory();
      const records = await historyService.getHistory();
      // Oldest first so the history renders in chronological order.
      for (const record of [...records].reverse()) {
        if (record?.direction !== "from" || !Array.isArray(record.batch)) {
          continue;
        }

        const batch = [];
        for (const item of record.batch) {
          if (item.isDirectoryMarker) {
            batch.push({
              name: item.name,
              size: item.size || 0,
              isDirectoryMarker: true,
              blob: null,
              lastModified: record.timestamp,
            });
            continue;
          }
          if (!item.opfsName) continue;
          try {
            const handle = await root.getFileHandle(item.opfsName);
            const blob = await handle.getFile();
            this.activeOpfsHandles.add(handle);
            batch.push({
              name: item.name,
              size: item.size || blob.size,
              isDirectoryMarker: false,
              blob,
              opfsHandle: handle,
              lastModified: record.timestamp,
            });
          } catch (err) {
            // File was deleted/evicted. Skip the entry entirely — it is no
            // longer downloadable, so re-rendering it would just show a
            // broken/expired entry the user does not want.
            console.warn(
              "Skipping history entry: persisted file not found",
              item.name,
              err,
            );
          }
        }

        if (batch.length === 0) continue;

        uiManager.renderTransferHistoryBatch({
          batch,
          direction: "from",
          rootDirectoryName: record.rootDirectoryName,
          statusSuffix: null,
          peerDisplay: record.peerDisplay,
          singleFileDownload: this._buildSingleFileDownload(batch),
          onZipDownload: async (button, displayName) => {
            await this.downloadSpecificBatch(batch, displayName);
          },
        });
      }
    } catch (e) {
      console.warn("Failed to restore persisted history:", e);
    }
  }

  // Nearly identical to the single-file download construction used at
  // receive-time, but driven by persisted OPFS blobs.
  _buildSingleFileDownload(batch) {
    const files = batch.filter((f) => !f.isDirectoryMarker);
    if (batch.length !== 1 || !files[0]?.blob) return null;
    const blobUrl = URL.createObjectURL(files[0].blob);
    this.activeBlobUrls.add(blobUrl);
    if (files[0]?.opfsHandle) {
      this._opfsBlobUrlHandles.add(files[0].opfsHandle);
    }
    return { url: blobUrl, fileName: files[0].name };
  }

  // Restores stored chat messages into the chat-history UI.
  async restoreChatHistory() {
    try {
      const chatRecords = await historyService.getChatHistory();
      if (!chatRecords || chatRecords.length === 0) return;
      uiManager.renderStoredChatHistory(chatRecords);
    } catch (e) {
      console.warn("Failed to restore chat history:", e);
    }
  }

  clearFileSelection() {
    this.selectedFiles = [];
    uiManager.clearFileInputs();
    uiManager.setFileSelectionSummary("");
    uiManager.setFileTransferButtonEnabled(false);
    this.isStopped = false;
    this.isPaused = false;
    this.pendingTransferStats = null;
    this.hasReportedTransferComplete = false;
    uiManager.resetSentTransferUI();
  }

  async cleanupAllTransfers() {
    try {
      this.cleanupSentTransfer();
      await this.cleanupReceivedTransfer();
      uiManager.clearFileAlert();
    } catch (error) {
      console.error("Cleanup failed:", error);
    }
  }
}

export let fileTransferManager = null;

const init = () => {
  fileTransferManager = new FileTransferManager(
    DEFAULT_SEND_RATE_LIMIT_BYTES_PER_SEC,
  );

  // Restore persisted received files and chat from the previous session.
  // Persisted OPFS files are re-opened and rendered with working download
  // links; chat messages are re-rendered exactly as they were.
  fileTransferManager.restorePersistedHistory().catch(console.warn);
  fileTransferManager.restoreChatHistory().catch(console.warn);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
