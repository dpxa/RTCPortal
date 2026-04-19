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

    this.initializeElements();
    this.initializeEventListeners();

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

  initializeElements() {
    this.uploadField = document.getElementById("upload-field");
    this.folderUploadField = document.getElementById("folder-upload-field");
    this.dropZone = document.getElementById("drop-zone");
    this.browseFilesBtn = document.getElementById("browse-files-btn");
    this.browseFolderBtn = document.getElementById("browse-folder-btn");
    this.fileNameDisplay = document.getElementById("file-name-display");

    this.fileTransferBtn = document.getElementById("file-transfer-btn");
    this.fileStatusMessage = document.getElementById("file-status-message");

    this.outgoingFoldersSection = document.getElementById(
      "outgoing-folders-section",
    );
    this.incomingFoldersSection = document.getElementById(
      "incoming-folders-section",
    );
    this.outgoingFilesSection = document.getElementById(
      "outgoing-files-section",
    );
    this.incomingFilesSection = document.getElementById(
      "incoming-files-section",
    );

    this.transferHistoryDiv = document.getElementById("transfer-history");
    this.outgoingFoldersContainer = document.getElementById("outgoing-folders");
    this.incomingFoldersContainer = document.getElementById("incoming-folders");
    this.outgoingFilesContainer = document.getElementById("outgoing-files");
    this.incomingFilesContainer = document.getElementById("incoming-files");
    this.eraseHistoryContainer = document.querySelector(
      ".erase-history-container",
    );
  }

  initializeEventListeners() {
    if (this.browseFilesBtn) {
      this.browseFilesBtn.addEventListener("click", () =>
        this.uploadField.click(),
      );
    }
    if (this.browseFolderBtn) {
      this.browseFolderBtn.addEventListener("click", async () => {
        if (window.showDirectoryPicker) {
          try {
            const dirHandle = await window.showDirectoryPicker();
            const files = await this.traverseDirHandle(dirHandle, "");
            this.handleFileSelection(files, dirHandle.name);
          } catch (e) {
            if (e.name !== "AbortError") {
              this.folderUploadField.click();
            }
          }
        } else {
          this.folderUploadField.click();
        }
      });
    }

    this.uploadField.addEventListener("change", () =>
      this.handleFileSelection(this.uploadField.files),
    );
    if (this.folderUploadField) {
      this.folderUploadField.addEventListener("change", () => {
        let rootFolderName = null;
        if (this.folderUploadField.files.length > 0) {
          const firstPath = this.folderUploadField.files[0].webkitRelativePath;
          if (firstPath && firstPath.includes("/")) {
            rootFolderName = firstPath.split("/")[0];
          }
        }
        this.handleFileSelection(this.folderUploadField.files, rootFolderName);
      });
    }

    if (this.dropZone) {
      ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
        this.dropZone.addEventListener(eventName, this.preventDefaults, false);
      });

      ["dragenter", "dragover"].forEach((eventName) => {
        this.dropZone.addEventListener(
          eventName,
          () => this.dropZone.classList.add("highlight"),
          false,
        );
      });

      ["dragleave", "drop"].forEach((eventName) => {
        this.dropZone.addEventListener(
          eventName,
          () => this.dropZone.classList.remove("highlight"),
          false,
        );
      });

      this.dropZone.addEventListener("drop", (e) => this.handleDrop(e), false);
    }

    this.fileTransferBtn.addEventListener("click", () => this.sendFile());

    const handleUnloadAndHide = () => {
      this.cleanupAllTransfers();
      this.revokeAllBlobUrls();
    };
    window.addEventListener("beforeunload", handleUnloadAndHide);
    window.addEventListener("pagehide", handleUnloadAndHide);

    document.addEventListener("clear-history", () => {
      this.revokeAllBlobUrls();

      if (this.outgoingFilesContainer)
        this.outgoingFilesContainer.innerHTML = "";
      if (this.incomingFilesContainer)
        this.incomingFilesContainer.innerHTML = "";
      if (this.outgoingFoldersContainer)
        this.outgoingFoldersContainer.innerHTML = "";
      if (this.incomingFoldersContainer)
        this.incomingFoldersContainer.innerHTML = "";

      if (this.transferHistoryDiv)
        this.transferHistoryDiv.style.display = "none";
      if (this.outgoingFilesSection)
        this.outgoingFilesSection.style.display = "none";
      if (this.incomingFilesSection)
        this.incomingFilesSection.style.display = "none";
      if (this.outgoingFoldersSection)
        this.outgoingFoldersSection.style.display = "none";
      if (this.incomingFoldersSection)
        this.incomingFoldersSection.style.display = "none";

      const eraseHistoryBtn = document.getElementById("erase-history-btn");
      if (eraseHistoryBtn) eraseHistoryBtn.remove();
    });

    document.addEventListener("paste", async (e) => {
      if (
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA")
      ) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      const filesPromises = [];
      let rootFolderName = null;
      let dirCount = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            if (entry.isDirectory) {
              dirCount++;
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

      if (dirCount !== 1) {
        rootFolderName = null;
      }

      const fileArrays = await Promise.all(filesPromises);
      const files = fileArrays.flat().filter((f) => f);

      if (files.length > 0) {
        this.handleFileSelection(files, rootFolderName);
      }
    });
  }

  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  async handleDrop(e) {
    const dt = e.dataTransfer;
    const items = dt.items;

    let rootFolderName = null;

    if (items) {
      const filesPromises = [];
      let entryCount = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            entryCount++;
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
    this.fileTransferBtn.disabled =
      this.selectedFiles.length === 0 ||
      !this.isDataChannelOpen() ||
      this.isSending;
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

  createMetaSpan(text) {
    const metaSpan = document.createElement("span");
    metaSpan.textContent = text;
    metaSpan.style.fontSize = "0.75rem";
    metaSpan.style.fontStyle = "italic";
    try {
      const mt = getComputedStyle(document.documentElement).getPropertyValue(
        "--meta-text",
      );
      metaSpan.style.color = mt ? mt.trim() : getCssVar("--meta-text", "#888");
    } catch (e) {
      metaSpan.style.color = getCssVar("--meta-text", "#888");
    }
    metaSpan.style.marginLeft = "8px";
    return metaSpan;
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
    if (this.fileNameDisplay) this.fileNameDisplay.textContent = "";
    if (this.fileTransferBtn) this.fileTransferBtn.disabled = true;
    this.resetInputFields();
  }

  resetInputFields() {
    if (this.uploadField) this.uploadField.value = "";
    if (this.folderUploadField) this.folderUploadField.value = "";
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
    if (!this.fileNameDisplay) return;

    if (this.rootDirectoryName) {
      const fileCount = this.selectedFiles.filter(
        (f) => !f.isDirectoryMarker,
      ).length;
      this.fileNameDisplay.textContent = `Selected Folder: ${this.rootDirectoryName} (${fileCount} file${fileCount !== 1 ? "s" : ""}, ${this.displayFileSize(totalSize)})`;
    } else if (this.selectedFiles.length === 1) {
      this.fileNameDisplay.textContent = `Selected: ${this.selectedFiles[0].name} (${this.displayFileSize(this.selectedFiles[0].size)})`;
    } else {
      this.fileNameDisplay.textContent = `Selected: ${this.selectedFiles.length} files (${this.displayFileSize(totalSize)})`;
    }
  }

  async sendFile() {
    if (!this.isDataChannelOpen()) {
      setTimeout(() => {
        if (window.webrtcManager) window.webrtcManager.resetCurrentConnection();
      }, CONNECTION_RESET_DELAY);
      return;
    }

    if (this.selectedFiles.length === 0) {
      uiManager.showFileAlert("No file selected.");
      return;
    }

    uiManager.clearFileAlert();
    this.fileTransferBtn.disabled = true;
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

      const nowMs = Date.now();
      if (i === 0 || nowMs - lastLoopYieldAndUI > 50) {
        uiManager.transferStatusDivSent.textContent = this.currentSendStatus;
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
      this.fileTransferBtn.disabled = true;
      uiManager.updateSentProgressBarValue(100);
      uiManager.updateSentStats("", "");

      if (uiManager.sentButtonsContainer) {
        uiManager.sentButtonsContainer.style.display = "none";
      }

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
        if (uiManager.transferStatusDivSent) {
          uiManager.transferStatusDivSent.textContent =
            "Waiting for receiver confirmation...";
        }
        this.pendingBatchForHistory = {
          batch: batchForHistory,
          direction: "to",
          rootDirectoryName: this.rootDirectoryName,
        };
      }
    } else {
      this.updateTransferButtonState();
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

      if (uiManager.pauseTransferBtn)
        uiManager.pauseTransferBtn.textContent = "Resume";
      uiManager.transferStatusDivSent.textContent = "Transfer Paused";
    } else {
      if (this.currentPauseStartSent) {
        this.totalPausedTimeSent =
          (this.totalPausedTimeSent || 0) +
          (Date.now() - this.currentPauseStartSent);
        this.currentPauseStartSent = 0;
      }
      if (this.isDataChannelOpen()) {
        webrtcManager.dataChannel.send(
          JSON.stringify({ type: "resume-transfer" }),
        );
      }

      if (uiManager.pauseTransferBtn)
        uiManager.pauseTransferBtn.textContent = "Pause";
      uiManager.transferStatusDivSent.textContent =
        this.currentSendStatus || "Sending...";
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
    this.fileTransferBtn.disabled = false;

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
    let lastUIUpdate = 0;

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
            setTimeout(r, document.hidden ? 100 : TRANSFER_PAUSE_POLL_INTERVAL),
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
            setTimeout(r, document.hidden ? 10 : TRANSFER_PAUSE_POLL_INTERVAL),
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
          now - lastUIUpdate > 50 ||
          (offset === fileObj.size && currentIdx === totalCount)
        ) {
          uiManager.ensureSentContainer();

          const currentTotalSent = totalBytesSentStart + offset;
          const totalSize = Number(totalBatchSize) || Number(fileObj.size) || 0;
          const progressValue =
            totalSize > 0
              ? Math.floor((currentTotalSent / totalSize) * 100)
              : 100;
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
          lastUIUpdate = now;
        }

        if (offset < fileObj.size) {
          readChunk(offset);
        } else {
          if (currentIdx === totalCount || Date.now() - lastUIUpdate > 100) {
            uiManager.transferStatusDivSent.textContent =
              this.formatBatchMessage(
                "Sent",
                currentIdx,
                totalCount,
                fileObj.name,
              );
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
              setTimeout(r, document.hidden ? 100 : TRANSFER_CLEANUP_DELAY),
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

  calculateTransferStats(
    bytesTransferred,
    totalBytes,
    startTime,
    now = Date.now(),
    isSending = true,
  ) {
    const elapsed = (now - startTime) / 1000;
    if (elapsed <= 0.1) return null;

    const ctxKey = isSending ? "_sendSpeedCtx" : "_recvSpeedCtx";
    let ctx = this[ctxKey];

    if (!ctx || ctx.startTime !== startTime) {
      ctx = {
        startTime: startTime,
        lastTime: now,
        lastBytes: bytesTransferred,
        currentSpeed: 0,
      };
      this[ctxKey] = ctx;
    }

    const deltaT = (now - ctx.lastTime) / 1000;

    if (deltaT >= 0.5) {
      const deltaB = bytesTransferred - ctx.lastBytes;
      const instantSpeed = deltaT > 0 ? deltaB / deltaT : 0;

      if (ctx.currentSpeed === 0) {
        ctx.currentSpeed = instantSpeed;
      } else {
        ctx.currentSpeed = ctx.currentSpeed * 0.4 + instantSpeed * 0.6;
      }

      ctx.lastTime = now;
      ctx.lastBytes = bytesTransferred;
    }

    let speed =
      ctx.currentSpeed > 0 ? ctx.currentSpeed : bytesTransferred / elapsed;
    const eta = speed > 0 ? (totalBytes - bytesTransferred) / speed : 0;

    return {
      speedStr: this.displayFileSize(speed) + "/s",
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

      await this._processIncomingBufferItem(data);

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
    uiManager.transferStatusDivReceived.textContent = "Transfer Paused";
  }

  handleTransferResume() {
    if (this.currentPauseStartReceived) {
      this.totalPausedTimeReceived =
        (this.totalPausedTimeReceived || 0) +
        (Date.now() - this.currentPauseStartReceived);
      this.currentPauseStartReceived = 0;
    }
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
    uiManager.transferStatusDivReceived.textContent = this.formatBatchMessage(
      "Receiving",
      info.batchIndex,
      info.batchTotal,
      info.fileName,
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

    const details = this.receivedFileDetails;

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

    if (
      !uiManager.transferStatusDivReceived ||
      !uiManager.transferStatusDivReceived.isConnected
    ) {
      uiManager.ensureReceivedContainer();
      uiManager.transferStatusDivReceived.textContent = this.formatBatchMessage(
        "Receiving",
        this.receivedFileDetails.batchIndex,
        this.receivedFileDetails.batchTotal,
        this.receivedFileDetails.fileName,
      );
    }

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
        uiManager.transferStatusDivReceived.textContent =
          this.formatBatchMessage(
            "Received",
            this.receivedFileDetails.batchIndex,
            this.receivedFileDetails.batchTotal,
            this.receivedFileDetails.fileName,
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

      const totalSizeToUse = Number(totalSize) || 0;
      const progressValue =
        totalSizeToUse > 0
          ? Math.floor((this.totalBatchBytesReceived / totalSizeToUse) * 100)
          : 100;
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
      uiManager.transferStatusDivReceived.textContent = this.formatBatchMessage(
        "Received",
        currentDetails.batchIndex,
        currentDetails.batchTotal,
        currentDetails.fileName,
      );
    }

    const isLastInBatch =
      currentDetails.batchIndex === currentDetails.batchTotal;

    if (isLastInBatch) {
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
        this.toggleClearHistoryOption();

        uiManager.resetReceivedTransferUI();
        this.totalBatchBytesReceived = 0;
      }, TRANSFER_CLEANUP_DELAY);
    }

    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
  }

  createBatchHistoryUI(batch, direction, rootDirectoryName) {
    const isFolderItem =
      !!rootDirectoryName ||
      batch.some((f) => f.isDirectoryMarker || f.name.includes("/"));

    const wrapperDiv = document.createElement("div");
    wrapperDiv.style.padding = "0";
    wrapperDiv.style.wordBreak = "break-all";

    let displayName = "Files";
    if (rootDirectoryName) {
      displayName = rootDirectoryName;
    } else if (isFolderItem && batch.length > 0) {
      displayName = batch[0].name.split("/")[0];
    } else if (batch.length === 1) {
      displayName = batch[0].name;
    } else {
      displayName = `${batch.length} files`;
    }

    const totalSize = batch.reduce((acc, f) => acc + (f.size || 0), 0);

    const isSingleFile = batch.length === 1 && !isFolderItem;

    if (direction === "from" && !isSingleFile) {
      const btnContainer = document.createElement("div");
      btnContainer.className = "batch-zip-container";

      const btn = document.createElement("button");
      btn.className = "zip-download-btn";
      const zipIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px; margin-bottom: 2px;"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`;

      if (isFolderItem) {
        btn.innerHTML = `${zipIcon} Download ${displayName}`;
      } else {
        btn.innerHTML = `${zipIcon} Download ${batch.length} files (ZIP)`;
      }

      btn.addEventListener("click", () => {
        const originalText = btn.innerHTML;
        btn.innerHTML = `${zipIcon} Zipping...`;
        btn.disabled = true;
        this.downloadSpecificBatch(batch, displayName).finally(() => {
          btn.innerHTML = originalText;
          btn.disabled = false;
        });
      });

      batch.forEach((f) => {
        if (f.opfsHandle) {
          this.activeOpfsHandles.add(f.opfsHandle);
        }
      });
      btnContainer.appendChild(btn);
      wrapperDiv.appendChild(btnContainer);
    } else if (direction === "from" && isSingleFile) {
      const f = batch[0];
      if (f.opfsHandle) {
        this.activeOpfsHandles.add(f.opfsHandle);
      }
    }

    const entryDiv = document.createElement("div");
    entryDiv.style.padding = "4px 0";
    entryDiv.style.display = "flex";
    entryDiv.style.flexWrap = "wrap";
    entryDiv.style.alignItems = "baseline";
    entryDiv.style.gap = "8px";

    const label =
      direction === "from" && isSingleFile && batch[0].blob
        ? document.createElement("a")
        : document.createElement("span");
    if (direction === "from" && isSingleFile && batch[0].blob) {
      const blobUrl = URL.createObjectURL(batch[0].blob);
      label.href = blobUrl;
      label.download = batch[0].name;
      this.activeBlobUrls.add(blobUrl);
    }
    label.textContent = displayName;
    label.style.fontWeight = "bold";
    entryDiv.appendChild(label);

    const peerDisplay = this.getPeerDisplay(webrtcManager.activePeerId);
    let metaText = `(${this.displayFileSize(totalSize)}) ${direction === "from" ? "Received from" : "Sent to"}: ${peerDisplay}, at ${new Date().toLocaleTimeString()}`;
    const metaSpan = this.createMetaSpan(metaText);
    metaSpan.style.marginLeft = "0";

    entryDiv.appendChild(metaSpan);

    wrapperDiv.appendChild(entryDiv);

    const targetContainer =
      direction === "from"
        ? isFolderItem
          ? this.incomingFoldersContainer
          : this.incomingFilesContainer
        : isFolderItem
          ? this.outgoingFoldersContainer
          : this.outgoingFilesContainer;

    const targetSection =
      direction === "from"
        ? isFolderItem
          ? this.incomingFoldersSection
          : this.incomingFilesSection
        : isFolderItem
          ? this.outgoingFoldersSection
          : this.outgoingFilesSection;

    if (targetContainer.firstChild) {
      targetContainer.insertBefore(wrapperDiv, targetContainer.firstChild);
    } else {
      targetSection.style.display = "block";
      targetContainer.appendChild(wrapperDiv);
    }

    this.toggleClearHistoryOption();
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
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${defaultName.replace(/[^a-zA-Z0-9.\-_ ]/g, "_")}.zip`;
      link.click();
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
    if (numBytes === 0) return "0 Bytes";
    const units = ["Bytes", "KB", "MB", "GB", "TB"];
    const order = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / Math.pow(1024, order)).toFixed(2)} ${units[order]}`;
  }

  toggleClearHistoryOption() {
    let eraseHistoryBtn = document.getElementById("erase-history-btn");
    if (!eraseHistoryBtn) {
      eraseHistoryBtn = document.createElement("button");
      eraseHistoryBtn.id = "erase-history-btn";
      eraseHistoryBtn.className = "erase-history-btn";
      eraseHistoryBtn.textContent = "Clear History";
      eraseHistoryBtn.addEventListener("click", () => {
        document.dispatchEvent(new Event("clear-history"));
      });
      this.eraseHistoryContainer.appendChild(eraseHistoryBtn);
    }
    this.transferHistoryDiv.style.display = "block";
    eraseHistoryBtn.style.display = "inline-block";
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
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;

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
    if (this.uploadField) this.uploadField.value = "";
    if (this.folderUploadField) this.folderUploadField.value = "";
    if (this.fileNameDisplay) this.fileNameDisplay.textContent = "";
    if (this.fileTransferBtn) this.fileTransferBtn.disabled = true;
    this.isStopped = false;
    this.isPaused = false;
    uiManager.resetSentTransferUI();
  }

  async cleanupAllTransfers() {
    this.cleanupSentTransfer();
    await this.cleanupReceivedTransfer();
    uiManager.clearFileAlert();
  }
}

const fileTransferManager = new FileTransferManager();
window.fileTransferManager = fileTransferManager;
