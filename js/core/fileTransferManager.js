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

class FileTransferManager {
  constructor() {
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
    this.sentCleanupTimer = null;

    this.configureUIBindings();

    this.sweepOrphanedOpfsFiles();
  }

  async sweepOrphanedOpfsFiles() {
    try {
      const root = await navigator.storage.getDirectory();
      for await (const [name, handle] of root.entries()) {
        try {
          await root.removeEntry(name, { recursive: true });
        } catch (e) {}
      }
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
    this.cleanupAllTransfers();
    this.revokeAllBlobUrls();
  }

  async handlePaste(event) {
    if (uiManager.isTextInputFocused()) {
      return;
    }

    const items = event.clipboardData?.items;
    if (!items) return;

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
            rootFolderName = entry.name;
          }
          filesPromises.push(this.traverseFileTree(entry));
          continue;
        }
      }

      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) filesPromises.push(Promise.resolve([file]));
      }
    }

    if (directoryCount !== 1) {
      rootFolderName = null;
    }

    try {
      const fileArrays = await Promise.all(filesPromises);
      const files = fileArrays.flat().filter((file) => file);

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

      let rootFolderName = null;

      if (items) {
        const filesPromises = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.webkitGetAsEntry) {
            const entry = item.webkitGetAsEntry();
            if (entry) {
              if (entry.isDirectory && items.length === 1) {
                rootFolderName = entry.name;
              }
              filesPromises.push(this.traverseFileTree(entry));
            }
          } else if (item.kind === "file") {
            filesPromises.push(Promise.resolve([item.getAsFile()]));
          }
        }
        const fileArrays = await Promise.all(filesPromises);
        const files = fileArrays.flat();
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
        item.file((file) => {
          file.customRelativePath = path + file.name;
          resolve([file]);
        });
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const entries = [];
        const readEntries = () => {
          dirReader.readEntries(async (result) => {
            if (result.length === 0) {
              if (entries.length === 0) {
                const folderPath = path + item.name + "/";
                const dummyFile = new File([], "");
                dummyFile.customRelativePath = folderPath;
                dummyFile.isDirectoryMarker = true;
                resolve([dummyFile]);
              } else {
                const promises = entries.map((entry) =>
                  this.traverseFileTree(entry, path + item.name + "/"),
                );
                const results = await Promise.all(promises);
                resolve(results.flat());
              }
            } else {
              entries.push(...result);
              readEntries();
            }
          });
        };
        readEntries();
      } else {
        resolve([]);
      }
    });
  }

  async traverseDirHandle(dirHandle, path = "") {
    const files = [];

    try {
      let hasEntries = false;
      for await (const entry of dirHandle.values()) {
        hasEntries = true;
        if (entry.kind === "file") {
          const file = await entry.getFile();
          file.customRelativePath = path + dirHandle.name + "/" + file.name;
          files.push(file);
        } else if (entry.kind === "directory") {
          const subFiles = await this.traverseDirHandle(
            entry,
            path + dirHandle.name + "/",
          );
          files.push(...subFiles);
        }
      }

      if (!hasEntries) {
        const folderPath = path + dirHandle.name + "/";
        const dummyFile = new File([], "");
        dummyFile.customRelativePath = folderPath;
        dummyFile.isDirectoryMarker = true;
        files.push(dummyFile);
      }
    } catch (error) {
      console.error("Directory traversal failed:", error);
    }

    return files;
  }

  isDataChannelOpen() {
    return (
      window.webrtcManager &&
      window.webrtcManager.dataChannel &&
      window.webrtcManager.dataChannel.readyState === "open"
    );
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
        for (const handle of this.activeOpfsHandles) {
          try {
            await root.removeEntry(handle.name);
          } catch (e) {}
        }
      } catch (e) {}
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
        `Total transfer size exceeds 2GB limit (${this.displayFileSize(totalSize)}). Please select fewer files.`,
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

  updateFileNameDisplay(totalSize) {
    let summary = "";

    if (this.rootDirectoryName) {
      const fileCount = this.selectedFiles.filter(
        (f) => !f.isDirectoryMarker,
      ).length;
      summary = `Selected Folder: ${this.rootDirectoryName} (${fileCount} file${fileCount !== 1 ? "s" : ""}, ${this.displayFileSize(totalSize)})`;
    } else if (this.selectedFiles.length === 1) {
      summary = `Selected: ${this.selectedFiles[0].name} (${this.displayFileSize(this.selectedFiles[0].size)})`;
    } else {
      summary = `Selected: ${this.selectedFiles.length} files (${this.displayFileSize(totalSize)})`;
    }

    uiManager.setFileSelectionSummary(summary);
  }

  async sendFile() {
    try {
      if (!this.isDataChannelOpen()) {
        setTimeout(() => {
          if (window.webrtcManager)
            window.webrtcManager.resetCurrentConnection();
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
        (acc, f) => acc + f.size,
        0,
      );
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
        if (i === 0 || nowMs - lastLoopYieldAndUI > 25) {
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

        totalBytesSent += fileToSend.size;
      }

      const wasStopped = this.isStopped;

      this.isStopped = false;
      this.isPaused = false;

      if (this.selectedFiles.length > 0 && !wasStopped) {
        uiManager.setFileTransferButtonEnabled(false);
        uiManager.updateSentProgressBarValue(100);
        uiManager.updateSentStats("", "");

        uiManager.setSentButtonsVisible(false);

        const batchForHistory = this.selectedFiles.map((f) => ({
          name: f.customRelativePath || f.webkitRelativePath || f.name,
          size: f.size,
          isDirectoryMarker: f.isDirectoryMarker || false,
          lastModified: f.lastModified || Date.now(),
        }));

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
      } else {
        this.updateTransferButtonState();
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
    this.updateTransferButtonState();
  }

  togglePause() {
    if (!this.isSending) return;
    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      this.currentPauseStartSent = Date.now();
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

      this._sendSpeedCtx = null;

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

    uiManager.updateSentStats("-", "-");

    uiManager.resetSentTransferUI();
  }

  async waitForWebRTCBuffer() {
    if (
      !this.isDataChannelOpen() ||
      webrtcManager.dataChannel.bufferedAmount <=
        DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT
    )
      return;

    return new Promise((resolve) => {
      const channel = webrtcManager.dataChannel;
      const onEvent = () => {
        channel.removeEventListener("bufferedamountlow", onEvent);
        channel.removeEventListener("close", onEvent);
        channel.removeEventListener("error", onEvent);
        resolve();
      };
      channel.addEventListener("bufferedamountlow", onEvent);
      channel.addEventListener("close", onEvent);
      channel.addEventListener("error", onEvent);
    });
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

      reader.onload = async (evt) => {
        if (this.isStopped) {
          this.cleanupSentTransfer();
          resolve();
          return;
        }

        while (this.isPaused || this.isAutoThrottled) {
          if (this.isStopped) {
            this.cleanupSentTransfer();
            resolve();
            return;
          }
          if (!this.isSending || !this.isDataChannelOpen()) {
            this.cleanupSentTransfer();
            reject("Transfer aborted");
            return;
          }
          await new Promise((r) =>
            setTimeout(
              r,
              appUtils.isPageHidden() ? 100 : TRANSFER_PAUSE_POLL_INTERVAL,
            ),
          );
        }

        if (!this.isSending || !this.isDataChannelOpen()) {
          this.cleanupSentTransfer();
          reject("Transfer aborted");
          return;
        }

        const chunk = evt.target.result;

        await this.waitForWebRTCBuffer();

        while (this.isPaused || this.isAutoThrottled) {
          if (this.isStopped) {
            this.cleanupSentTransfer();
            resolve();
            return;
          }
          if (!this.isSending || !this.isDataChannelOpen()) {
            this.cleanupSentTransfer();
            reject("Transfer aborted");
            return;
          }
          await new Promise((r) =>
            setTimeout(
              r,
              appUtils.isPageHidden() ? 10 : TRANSFER_PAUSE_POLL_INTERVAL,
            ),
          );
        }

        try {
          webrtcManager.dataChannel.send(chunk);
          this.sentBytes += chunk.byteLength || chunk.length || 0;
          offset += chunk.byteLength;
        } catch (e) {
          console.error("Data channel send error:", e);
          this.cleanupSentTransfer();
          reject("Transfer aborted due to send error: " + e.message);
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
          const progressValue = this.calculateProgressPercent(
            currentTotalSent,
            totalSize,
          );
          uiManager.updateSentProgressBarValue(progressValue);

          const effectivePauseTime =
            (this.totalPausedTimeSent || 0) +
            (this.isPaused && this.currentPauseStartSent
              ? now - this.currentPauseStartSent
              : 0);

          const stats = this.calculateTransferStats(
            currentTotalSent,
            totalSize,
            batchStartTime + effectivePauseTime,
            now,
            true,
          );
          if (stats) {
            uiManager.updateSentStats(stats.speedStr, stats.etaStr);
          }
          this.lastSentUIUpdate = Date.now();

          await yieldToMain();
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
            if (window.webrtcManager && window.webrtcManager.socket) {
              window.webrtcManager.socket.emit("transfer-complete", {
                fileSize: totalBatchSize,
              });
            }

            uiManager.updateSentStats("", "");
            if (window.statsService) {
              window.statsService.fetchConnectionStats();
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
        console.error("File read error:", error);
        this.cleanupSentTransfer();
        reject(error);
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
    if (seconds < 60) return Math.ceil(seconds) + "s";
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return `${m}m ${s}s`;
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
      speedStr: this.displayFileSize(ctx.currentSpeed) + "/s",
      etaStr: this.formatTime(eta),
    };
  }

  handleIncomingData(data) {
    if (!this.receiveBuffer) {
      this.receiveBuffer = [];
      this.receiveBufferSize = 0;
    }
    this.receiveBuffer.push(data);
    this.receiveBufferSize += data.byteLength || data.length || 0;

    if (this.receiveBufferSize > 20 * 1024 * 1024 && !this.isThrottlingSender) {
      this.isThrottlingSender = true;
      const dataChannel = window.webrtcManager?.dataChannel;
      if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(JSON.stringify({ type: "throttle-pause" }));
      }
    }

    if (!this.isProcessingReceive) {
      this.isProcessingReceive = true;
      Promise.resolve().then(() => this.processReceiveBuffer());
    }
  }

  async processReceiveBuffer() {
    let processCount = 0;
    let loopStartTime = performance.now();

    while (this.receiveBuffer && this.receiveBuffer.length > 0) {
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
      if (processCount % 10 === 0) {
        this._checkThrottleResumeOnBufferLow();

        if (performance.now() - loopStartTime >= 10) {
          await yieldToMain();
          loopStartTime = performance.now();
        }
      }
    }

    this._checkThrottleResumeOnBufferLow();
    this.isProcessingReceive = false;
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
      const dataChannel = window.webrtcManager?.dataChannel;
      if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(JSON.stringify({ type: "throttle-resume" }));
      }
    }
  }

  async processControlInstruction(input) {
    try {
      const info = JSON.parse(input);

      switch (info.type) {
        case "metadata":
          await this.handleIncomingMetadata(info);
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
          console.warn("Unknown control instruction:", info.type);
      }
    } catch (err) {
      console.log("Received unparsable text message:", input);
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
    this.cleanupReceivedTransfer();
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

    uiManager.ensureReceivedContainer();
    uiManager.setReceivedStatus(
      this.formatBatchMessage(
        "Receiving",
        this.receivedFileDetails.batchIndex,
        this.receivedFileDetails.batchTotal,
        this.receivedFileDetails.fileName,
      ),
    );

    const now = Date.now();
    if (
      now - this.lastReceivedUIUpdate > 100 ||
      this.receivedBytes === this.receivedFileDetails.fileSize
    ) {
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
            ? now - this.currentPauseStartReceived
            : 0);
        const stats = this.calculateTransferStats(
          this.totalBatchBytesReceived,
          totalSize,
          this.receivedBatchStartTime + effectivePauseTime,
          now,
          false,
        );
        if (stats) {
          uiManager.updateReceivedStats(stats.speedStr, stats.etaStr);
        }
      }

      const progressValue = this.calculateProgressPercent(
        this.totalBatchBytesReceived,
        totalSize,
      );
      uiManager.updateReceivedProgressBarValue(progressValue);
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
        } catch (e) {}
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

    currentChunks = null;

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

    const batchProgressValue = this.calculateProgressPercent(
      this.totalBatchBytesReceived,
      currentDetails.totalBatchSize,
    );
    uiManager.updateReceivedProgressBarValue(batchProgressValue);

    if (isLastInBatch) {
      uiManager.updateReceivedProgressBarValue(100);
      uiManager.updateReceivedStats("", "");

      if (
        window.webrtcManager &&
        window.webrtcManager.dataChannel &&
        window.webrtcManager.dataChannel.readyState === "open"
      ) {
        window.webrtcManager.dataChannel.send(
          JSON.stringify({ type: "batch-received" }),
        );
      }

      if (window.statsService) {
        window.statsService.fetchConnectionStats();
      }
      this.receivedCleanupTimer = setTimeout(() => {
        this.createBatchHistoryUI(
          this.receivedBatch,
          "from",
          this.receivedBatchRootName,
        );

        this.receivedBatch = [];

        uiManager.resetReceivedTransferUI();
        this.totalBatchBytesReceived = 0;
      }, TRANSFER_CLEANUP_DELAY);
    }

    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
  }

  createBatchHistoryUI(batch, direction, rootDirectoryName) {
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

    const zip = new JSZip();
    const createdDirs = new Set();

    files.forEach((file) => {
      const fileDate = file.lastModified
        ? new Date(file.lastModified)
        : new Date();

      const pathParts = file.name.split("/");
      let currentPath = "";

      const dirsToCreate =
        file.isDirectoryMarker || file.name.endsWith("/")
          ? pathParts
          : pathParts.slice(0, -1);

      for (const part of dirsToCreate) {
        if (!part) continue;
        currentPath += part + "/";
        if (!createdDirs.has(currentPath)) {
          zip.file(currentPath, null, { dir: true, date: fileDate });
          createdDirs.add(currentPath);
        }
      }

      if (!file.isDirectoryMarker && !file.name.endsWith("/")) {
        zip.file(file.name, file.blob, { date: fileDate });
      }
    });

    try {
      const content = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });
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

  displayFileSize(numBytes) {
    return appUtils.formatBytes(numBytes);
  }

  cleanupSentTransfer() {
    this.isSending = false;
    this.isPaused = false;
    this.isAutoThrottled = false;
    this.pendingBatchForHistory = null;
    this.hasReceivedBatchConfirmation = false;

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

  async cleanupReceivedTransfer() {
    this.isReceiving = false;
    this.isPaused = false;
    this._recvSpeedCtx = null;
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receiveBuffer = [];
    this.receiveBufferSize = 0;
    this.isThrottlingSender = false;
    this.receivedBytes = 0;
    this.totalBatchBytesReceived = 0;

    if (this.receivedBatch && this.receivedBatch.length > 0) {
      if (this.receivedBatchRootName) {
        this.createBatchHistoryUI(
          [...this.receivedBatch],
          "from",
          this.receivedBatchRootName,
        );
      } else {
        this.createBatchHistoryUI([...this.receivedBatch], "from", null);
      }
      this.receivedBatch = [];
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
      } catch (e) {}
      this.opfsWritable = null;
    }
    if (this.opfsFileHandle) {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(this.opfsFileHandle.name);
      } catch (e) {}
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

const fileTransferManager = new FileTransferManager();
window.fileTransferManager = fileTransferManager;
