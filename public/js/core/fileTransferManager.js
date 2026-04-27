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
    this._items = this._items.slice(this._head);
    this._head = 0;
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
  constructor(webrtcManager) {
    this.webrtcManager = webrtcManager;
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

    this.configureUIBindings();

    this.sweepOrphanedOpfsFiles();
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
    });

    this.hasReportedTransferComplete = true;
    this.pendingTransferStats = null;
  }

  async sweepOrphanedOpfsFiles() {
    try {
      const root = await navigator.storage.getDirectory();
      const removals = [];
      for await (const [name] of root.entries()) {
        removals.push(root.removeEntry(name, { recursive: true }));
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
    Promise.allSettled([this.cleanupAllTransfers(), this.revokeAllBlobUrls()])
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
      uiManager.showFileWarning("Could not parse pasted files.");
    }
  }

  async handleClearHistory() {
    try {
      await this.revokeAllBlobUrls();
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
      uiManager.showFileWarning("Could not process dropped files.");
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
    const peerName = uiManager.getNickname
      ? uiManager.getNickname(peerId)
      : peerId;
    return peerName === peerId ? peerName : `${peerName} (${peerId})`;
  }

  async revokeAllBlobUrls() {
    this.activeBlobUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.activeBlobUrls.clear();

    if (this.activeOpfsHandles.size > 0) {
      try {
        const root = await navigator.storage.getDirectory();
        await Promise.allSettled(
          [...this.activeOpfsHandles].map((handle) =>
            root.removeEntry(handle.name),
          ),
        );
      } catch (error) {
        console.error("Failed to clean up OPFS history files:", error);
      }
      this.activeOpfsHandles.clear();
    }
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
        `Total transfer size exceeds 2GB limit (${appUtils.formatBytes(totalSize)}). Please select fewer files.`,
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
    while (this.isPaused || this.isAutoThrottled) {
      if (this._shouldAbortTransfer()) {
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

      if (this.selectedFiles.length === 0) {
        uiManager.showFileAlert("No file selected.");
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
      const batchStartTime = Date.now();

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

        webrtcManager.dataChannel.send(
          JSON.stringify({
            type: "metadata",
            fileName: currentFileName,
            fileSize: fileToSend.size,
            lastModified: fileToSend.lastModified || Date.now(),
            batchIndex: i + 1,
            batchTotal: this.selectedFiles.length,
            totalBatchSize: totalBatchSize,
            isDirectoryMarker: fileToSend.isDirectoryMarker || false,
            rootDirectoryName: this.rootDirectoryName || null,
          }),
        );

        try {
          await this.sendFileSlicesPromise(
            fileToSend,
            i + 1,
            this.selectedFiles.length,
            totalBatchSize,
            totalBytesSent,
            batchStartTime,
          );
        } catch (err) {
          console.warn("Transfer aborted or failed:", err);
          break;
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
        uiManager.updateSentProgressBarValue(100);
        uiManager.updateSentStats("", "");
        uiManager.setSentButtonsVisible(false);

        const batchForHistory = this.selectedFiles.map((file) =>
          this._buildTransferHistoryEntry(file),
        );

        if (this.hasReceivedBatchConfirmation) {
          this.finalizeSentBatchForHistory(
            batchForHistory,
            "to",
            this.rootDirectoryName,
          );
        } else {
          uiManager.setSentStatus("Waiting for receiver confirmation...");
          this.pendingBatchForHistory = {
            batch: batchForHistory,
            direction: "to",
            rootDirectoryName: this.rootDirectoryName,
          };
        }
      }
    } catch (error) {
      console.error("Unexpected send pipeline failure:", error);
      uiManager.showFileWarning("Transfer failed unexpectedly.");
      this.cleanupSentTransfer();
    }
  }

  finalizeSentBatchForHistory(batch, direction, rootDirectoryName) {
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
      lastModified: file.lastModified || Date.now(),
    };
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
        webrtcManager.dataChannel.send(
          JSON.stringify({ type: "pause-transfer" }),
        );
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

      if (this.isDataChannelOpen()) {
        webrtcManager.dataChannel.send(
          JSON.stringify({ type: "resume-transfer" }),
        );
      }

      uiManager.setPauseButtonLabel("Pause");
      uiManager.setSentStatus(this.currentSendStatus || "Sending...");
    }
  }

  stopTransfer() {
    this.isStopped = true;
    this.isPaused = false;

    if (this.isDataChannelOpen()) {
      webrtcManager.dataChannel.send(
        JSON.stringify({ type: "cancel-transfer" }),
      );
    }

    this.isSending = false;
    uiManager.setFileTransferButtonEnabled(true);

    this._renderIncompleteSentHistoryIfNeeded("Incomplete");

    uiManager.updateSentStats("-", "-");

    uiManager.resetSentTransferUI();
  }

  async waitForWebRTCBuffer() {
    const channel = webrtcManager?.dataChannel;
    if (!channel || channel.readyState !== "open") {
      return;
    }

    let bufferRetries = 0;
    const MAX_BUFFER_RETRIES = 100;

    while (
      channel.readyState === "open" &&
      channel.bufferedAmount > DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT &&
      bufferRetries++ < MAX_BUFFER_RETRIES
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
        }, 50);

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
      metadata.fileName.length <= 1024;
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

    return (
      fileNameIsValid &&
      fileSizeIsValid &&
      batchIndexIsValid &&
      batchTotalIsValid
    );
  }

  async sendFileSlicesPromise(
    fileObj,
    currentIdx,
    totalCount,
    totalBatchSize,
    totalBytesSentStart,
    batchStartTime,
  ) {
    if (this.isStopped) return Promise.resolve();

    this.isSending = true;

    return new Promise((resolve, reject) => {
      let offset = 0;
      const reader = new FileReader();

      const abortTransfer = (reason, error) => {
        console.error(reason, error || "");
        this.cleanupSentTransfer();
        reject(error || new Error(reason));
      };

      reader.onload = async (evt) => {
        if (this.isStopped) {
          this.cleanupSentTransfer();
          resolve();
          return;
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
            return;
          }
        }

        if (this._shouldAbortTransfer()) {
          this.cleanupSentTransfer();
          reject(new Error("Transfer aborted"));
          return;
        }

        const chunk = evt.target.result;

        if (this.isPaused || this.isAutoThrottled) {
          if (
            !(await this._waitForTransferResume({
              visibleInterval: TRANSFER_PAUSE_POLL_INTERVAL,
              hiddenInterval: 10,
            }))
          ) {
            this.cleanupSentTransfer();
            resolve();
            return;
          }
        }

        try {
          if (this._shouldAbortTransfer()) {
            abortTransfer("Transfer aborted", new Error("Transfer aborted"));
            return;
          }

          await this.waitForWebRTCBuffer();
          webrtcManager.dataChannel.send(chunk);
          this.sentBytes += chunk.byteLength || chunk.length || 0;
          offset += chunk.byteLength;
        } catch (e) {
          abortTransfer(
            "Data channel send error",
            new Error("Transfer aborted due to send error: " + e.message),
          );
          return;
        }

        const now = Date.now();
        if (
          !this.lastSentUIUpdate ||
          now - this.lastSentUIUpdate > 50 ||
          (offset === fileObj.size && currentIdx === totalCount)
        ) {
          uiManager.ensureSentContainer();

          const currentTotalSent = totalBytesSentStart + offset;
          const totalSize = Number(totalBatchSize) || Number(fileObj.size) || 0;
          uiManager.updateSentProgressBarValue(
            this.calculateProgressPercent(currentTotalSent, totalSize),
          );

          const effectivePauseTime =
            (this.totalPausedTimeSent || 0) +
            (this.isPaused && this.currentPauseStartSent
              ? Date.now() - this.currentPauseStartSent
              : 0);
          const stats = this.calculateTransferStats(
            currentTotalSent,
            totalSize,
            batchStartTime,
            now - effectivePauseTime,
            true,
          );
          if (stats) {
            uiManager.updateSentStats(stats.speedStr, stats.etaStr);
          }
          this.lastSentUIUpdate = Date.now();
        }

        if (offset < fileObj.size) {
          readChunk(offset);
        } else {
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

          webrtcManager.dataChannel.send(JSON.stringify({ type: "done" }));

          if (currentIdx === totalCount) {
            uiManager.updateSentStats("", "");
            if (window.statsService) {
              window.statsService.requestConnectionStats();
            }
            await new Promise((r) =>
              setTimeout(
                r,
                appUtils.isPageHidden() ? 100 : TRANSFER_CLEANUP_DELAY,
              ),
            );
            this.isSending = false;
          }

          resolve();
        }
      };

      reader.onerror = (error) => {
        abortTransfer("File read error", error);
      };

      function readChunk(position) {
        reader.readAsArrayBuffer(
          fileObj.slice(position, position + SLICE_SIZE),
        );
      }
      readChunk(0);
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
    this.receiveBuffer.push(data);
    this.receiveBufferSize += data.byteLength || data.length || 0;

    if (this.receiveBufferSize > 20 * 1024 * 1024 && !this.isThrottlingSender) {
      this.isThrottlingSender = true;
      const dataChannel = this.webrtcManager?.dataChannel;
      if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(JSON.stringify({ type: "throttle-pause" }));
      }
    }

    if (!this.isProcessingReceive) {
      this.isProcessingReceive = true;
      Promise.resolve()
        .then(() => this.processReceiveBuffer(this.receiveSessionId))
        .catch((error) => {
          console.error("Receive buffer processing crashed:", error);
        })
        .finally(() => {
          this.isProcessingReceive = false;

          if (this.receiveBuffer?.length && !this.isProcessingReceive) {
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
    if (this.isThrottlingSender && this.receiveBufferSize < 5 * 1024 * 1024) {
      this.isThrottlingSender = false;
      const dataChannel = this.webrtcManager?.dataChannel;
      if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(JSON.stringify({ type: "throttle-resume" }));
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
          break;
        case "throttle-resume":
          this.isAutoThrottled = false;
          break;
        case "done":
          await this.finalizeIncomingFile();
          this.isReceiving = false;
          break;
        case "batch-received":
          this._reportTransferCompleteIfPending();
          if (this.pendingBatchForHistory) {
            this.finalizeSentBatchForHistory(
              this.pendingBatchForHistory.batch,
              this.pendingBatchForHistory.direction,
              this.pendingBatchForHistory.rootDirectoryName,
            );
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
      uiManager.showFileWarning("Received malformed transfer control data.");
    }
  }

  handleTransferPause() {
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

    this._recvSpeedCtx = null;
  }

  handleTransferCancellation() {
    this.cleanupReceivedTransfer({ statusSuffix: "Incomplete" }).catch(
      (error) => {
        console.error("Failed to cancel incoming transfer cleanly:", error);
      },
    );
    uiManager.showFileWarning("Sender cancelled transfer.");
  }

  async handleIncomingMetadata(info) {
    if (this.receivedCleanupTimer) {
      clearTimeout(this.receivedCleanupTimer);
      this.receivedCleanupTimer = null;
    }

    uiManager.ensureReceivedContainer();

    if (info.batchIndex === 1) {
      this.receivedBatch = [];
      this.receivedBatchRootName = info.rootDirectoryName || null;
      this.totalBatchBytesReceived = 0;
      this.receivedBatchStartTime = Date.now();

      this.totalPausedTimeReceived = 0;
      this.currentPauseStartReceived = 0;
      this._recvSpeedCtx = null;

      uiManager.resetReceivedProgressOnly();
      uiManager.updateReceivedStats("-", "-");
    }

    this.receivedFileDetails = {
      fileName: info.fileName,
      fileSize: info.fileSize,
      lastModified: info.lastModified || Date.now(),
      batchIndex: info.batchIndex || 1,
      batchTotal: info.batchTotal || 1,
      totalBatchSize: info.totalBatchSize || info.fileSize,
      isDirectoryMarker: info.isDirectoryMarker || false,
    };

    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.isReceiving = true;
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
    try {
      const root = await navigator.storage.getDirectory();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const tempFileName = `temp_${Date.now()}_${safeFileName}`;

      this.opfsFileHandle = await root.getFileHandle(tempFileName, {
        create: true,
      });
      this.opfsWritable = await this.opfsFileHandle.createWritable();

      const chunksToWrite = this.collectedChunks;
      this.collectedChunks = [];

      for (const chunk of chunksToWrite) {
        await this.opfsWritable.write(chunk);
      }
      this.opfsReady = true;
    } catch (e) {
      console.error("OPFS setup failed, falling back to memory storage.", e);
      this.opfsReady = false;
    }
  }

  async processIncomingChunk(arrayBuffer) {
    if (!this.receivedFileDetails) return;

    if (this.opfsReady && this.opfsWritable) {
      try {
        await this.opfsWritable.write(arrayBuffer);
      } catch (err) {
        console.error("OPFS write error:", err);
      }

      if (!this.receivedFileDetails) return;
    } else {
      this.collectedChunks.push(arrayBuffer);
    }
    this.receivedBytes += arrayBuffer.byteLength;
    this.totalBatchBytesReceived += arrayBuffer.byteLength;

    const now = Date.now();
    if (
      now - this.lastReceivedUIUpdate > 100 ||
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
        const effectivePauseTime =
          (this.totalPausedTimeReceived || 0) +
          (this.currentPauseStartReceived
            ? Date.now() - this.currentPauseStartReceived
            : 0);
        const stats = this.calculateTransferStats(
          this.totalBatchBytesReceived,
          totalSize,
          this.receivedBatchStartTime,
          now - effectivePauseTime,
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
    let currentChunks = this.collectedChunks;

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
          fileBlob = await currentFileHandle.getFile();
          fileHandle = currentFileHandle;
        } catch (err) {
          console.error("Error finalizing OPFS file:", err);
          fileBlob = new Blob(currentChunks);
        }
      } else {
        fileBlob = new Blob(currentChunks);
      }
    }

    this.receivedBatch.push({
      name: currentDetails.fileName,
      blob: fileBlob,
      opfsHandle: fileHandle,
      isDirectoryMarker: currentDetails.isDirectoryMarker,
      lastModified: currentDetails.lastModified,
      size: currentDetails.fileSize,
    });

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
      uiManager.updateReceivedProgressBarValue(100);
      uiManager.updateReceivedStats("", "");

      if (
        this.webrtcManager &&
        this.webrtcManager.dataChannel &&
        this.webrtcManager.dataChannel.readyState === "open"
      ) {
        this.webrtcManager.dataChannel.send(
          JSON.stringify({ type: "batch-received" }),
        );
      }

      if (window.statsService) {
        window.statsService.requestConnectionStats();
      }
      if (this.receivedCleanupTimer) {
        clearTimeout(this.receivedCleanupTimer);
      }
      this.receivedCleanupTimer = setTimeout(() => {
        this._queueReceivedBatchHistory();

        uiManager.resetReceivedTransferUI();
        this.totalBatchBytesReceived = 0;
        this.receivedCleanupTimer = null;
      }, TRANSFER_CLEANUP_DELAY);
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

    let singleFileDownload = null;
    if (direction === "from" && isSingleFile && batch[0].blob) {
      const blobUrl = URL.createObjectURL(batch[0].blob);
      this.activeBlobUrls.add(blobUrl);
      singleFileDownload = {
        url: blobUrl,
        fileName: batch[0].name,
      };
    }

    uiManager.renderTransferHistoryBatch({
      batch,
      direction,
      rootDirectoryName,
      statusSuffix,
      peerDisplay: this.getPeerDisplay(webrtcManager.activePeerId),
      singleFileDownload,
      onZipDownload: async (_button, displayName) => {
        await this.downloadSpecificBatch(batch, displayName);
      },
    });
  }

  async downloadSpecificBatch(files, defaultName) {
    if (!files || files.length === 0) return;

    if (typeof JSZip === "undefined") {
      uiManager.showFileWarning(
        "ZIP library failed to load. Downloads blocked.",
      );
      console.warn("JSZip library is missing (blocked by network).");
      return;
    }

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
        "Failed to create ZIP: Transfer may be too large for browser memory.",
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
      throw new Error(
        "ZIP generation failed. Please try again or download files individually.",
        { cause: error },
      );
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
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(this.opfsFileHandle.name);
      } catch (error) {
        console.error("Failed to remove OPFS temp file during cleanup:", error);
      }
      this.opfsFileHandle = null;
    }
    this.opfsReady = false;

    uiManager.resetReceivedTransferUI();
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

const fileTransferManager = new FileTransferManager(window.webrtcManager);
window.fileTransferManager = fileTransferManager;
