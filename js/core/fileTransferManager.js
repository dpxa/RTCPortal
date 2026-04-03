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
    this.outgoingSectionDiv = document.getElementById("outgoing-section");
    this.incomingSectionDiv = document.getElementById("incoming-section");
    this.transferHistoryDiv = document.getElementById("transfer-history");
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
      this.browseFolderBtn.addEventListener("click", () =>
        this.folderUploadField.click(),
      );
    }

    this.uploadField.addEventListener("change", () =>
      this.handleFileSelection(this.uploadField.files),
    );
    if (this.folderUploadField) {
      this.folderUploadField.addEventListener("change", () =>
        this.handleFileSelection(this.folderUploadField.files),
      );
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

    window.addEventListener("beforeunload", () => {
      this.cleanupAllTransfers();
      this.revokeAllBlobUrls();
    });
  }

  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  async handleDrop(e) {
    const dt = e.dataTransfer;
    const items = dt.items;

    if (items) {
      const filesPromises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            filesPromises.push(this.traverseFileTree(entry));
          }
        } else if (item.kind === "file") {
          filesPromises.push(Promise.resolve([item.getAsFile()]));
        }
      }
      const fileArrays = await Promise.all(filesPromises);
      const files = fileArrays.flat();
      this.handleFileSelection(files);
    } else {
      this.handleFileSelection(dt.files);
    }
  }

  traverseFileTree(item) {
    return new Promise((resolve) => {
      if (item.isFile) {
        item.file((file) => {
          resolve([file]);
        });
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const entries = [];
        const readEntries = () => {
          dirReader.readEntries(async (result) => {
            if (result.length === 0) {
              const promises = entries.map((entry) =>
                this.traverseFileTree(entry),
              );
              const results = await Promise.all(promises);
              resolve(results.flat());
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

  createHistoryEntry({ name, size, direction, blob, opfsHandle }) {
    const wrapperDiv = document.createElement("div");
    wrapperDiv.style.padding = "4px 0";
    wrapperDiv.style.wordBreak = "break-all";
    wrapperDiv.style.overflowWrap = "anywhere";

    const label = blob
      ? document.createElement("a")
      : document.createElement("span");
    if (blob) {
      const blobUrl = URL.createObjectURL(blob);
      label.href = blobUrl;
      label.download = name;
      this.activeBlobUrls.add(blobUrl);
      if (opfsHandle) {
        this.activeOpfsHandles.add(opfsHandle);
      }
    }
    label.textContent = name;
    label.style.fontWeight = "bold";

    const peerDisplay = this.getPeerDisplay(webrtcManager.activePeerId);
    const metaText = ` size: ${this.displayFileSize(size)}, ${direction}: ${peerDisplay}, at: ${new Date().toLocaleTimeString()}`;
    const metaSpan = this.createMetaSpan(metaText);

    wrapperDiv.appendChild(label);
    wrapperDiv.appendChild(metaSpan);
    return { wrapperDiv, label };
  }

  insertHistoryEntry(container, sectionDiv, wrapperDiv) {
    if (container.firstChild) {
      container.insertBefore(wrapperDiv, container.firstChild);
    } else {
      sectionDiv.style.display = "block";
      container.appendChild(wrapperDiv);
    }
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
    if (this.fileNameDisplay) this.fileNameDisplay.textContent = "";
    if (this.fileTransferBtn) this.fileTransferBtn.disabled = true;
    this.resetInputFields();
  }

  resetInputFields() {
    if (this.uploadField) this.uploadField.value = "";
    if (this.folderUploadField) this.folderUploadField.value = "";
  }

  handleFileSelection(files) {
    if (!files || files.length === 0) {
      this.clearFileSelectionUI();
      return;
    }

    const fileArray = Array.from(files);
    const totalSize = fileArray.reduce((acc, file) => acc + file.size, 0);
    const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

    if (totalSize > MAX_SIZE) {
      uiManager.showFileWarning(
        `Total transfer size exceeds 2GB limit (${this.displayFileSize(totalSize)}). Please select fewer files.`,
      );
      this.clearFileSelectionUI();
      return;
    }

    this.selectedFiles = fileArray;
    this.updateFileNameDisplay(totalSize);
    this.updateTransferButtonState();
    this.resetInputFields();
  }

  updateFileNameDisplay(totalSize) {
    if (!this.fileNameDisplay) return;

    if (this.selectedFiles.length === 1) {
      this.fileNameDisplay.textContent = `Selected: ${this.selectedFiles[0].name} (${this.displayFileSize(this.selectedFiles[0].size)})`;
    } else {
      this.fileNameDisplay.textContent = `Selected: ${this.selectedFiles.length} files (${this.displayFileSize(totalSize)})`;
    }
  }

  async sendFile() {
    if (!this.isDataChannelOpen()) {
      setTimeout(() => {
        if (window.webrtcManager) window.webrtcManager.resetCurrentConnection();
      }, 4000);
      return;
    }

    if (this.selectedFiles.length === 0) {
      uiManager.showFileAlert("No file selected.");
      return;
    }

    uiManager.clearFileAlert();
    this.fileTransferBtn.disabled = true;

    const totalBatchSize = this.selectedFiles.reduce(
      (acc, f) => acc + f.size,
      0,
    );
    let totalBytesSent = 0;
    const batchStartTime = Date.now();

    for (let i = 0; i < this.selectedFiles.length; i++) {
      if (this.isStopped) break;

      const fileToSend = this.selectedFiles[i];

      uiManager.ensureSentContainer();

      if (i === 0) {
        uiManager.resetSentProgressOnly();
        uiManager.updateSentStats("-", "-");
      }

      this.currentSendStatus = this.formatBatchMessage(
        "Sending",
        i + 1,
        this.selectedFiles.length,
        fileToSend.name,
      );
      uiManager.transferStatusDivSent.textContent = this.currentSendStatus;

      webrtcManager.dataChannel.send(
        JSON.stringify({
          type: "metadata",
          fileName: fileToSend.name,
          fileSize: fileToSend.size,
          batchIndex: i + 1,
          batchTotal: this.selectedFiles.length,
          totalBatchSize: totalBatchSize,
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

    this.fileTransferBtn.disabled = false;

    this.isStopped = false;
    this.isPaused = false;

    if (this.selectedFiles.length > 0 && !wasStopped) {
      uiManager.updateSentProgressBarValue(100);

      uiManager.resetSentTransferUI();
    }
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
      webrtcManager.dataChannel.bufferedAmount <= 65535 * 4
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

        while (this.isPaused) {
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
          await new Promise((r) => setTimeout(r, 200));
        }

        if (!this.isSending || !this.isDataChannelOpen()) {
          this.cleanupSentTransfer();
          reject("Transfer aborted");
          return;
        }

        const chunk = evt.target.result;

        await this.waitForWebRTCBuffer();

        while (this.isPaused) {
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
          await new Promise((r) => setTimeout(r, 100));
        }

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
        webrtcManager.dataChannel.send(chunk);

        offset += chunk.byteLength;

        const now = Date.now();
        if (now - lastUIUpdate > 100 || offset === fileObj.size) {
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
          );
          if (stats) {
            uiManager.updateSentStats(stats.speedStr, stats.etaStr);
          }
          lastUIUpdate = now;
        }

        if (offset < fileObj.size) {
          readChunk(offset);
        } else {
          uiManager.transferStatusDivSent.textContent = this.formatBatchMessage(
            "Sent",
            currentIdx,
            totalCount,
            fileObj.name,
          );

          webrtcManager.dataChannel.send(JSON.stringify({ type: "done" }));

          if (window.webrtcManager && window.webrtcManager.socket) {
            window.webrtcManager.socket.emit("transfer-complete", {
              fileSize: fileObj.size,
            });
          }

          if (currentIdx === totalCount) {
            uiManager.updateSentStats("", "");
            await new Promise((r) => setTimeout(r, 600));
            this.isSending = false;
          }

          this.recordSentFile(fileObj);

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
  ) {
    const elapsed = (now - startTime) / 1000;
    if (elapsed <= 0.5) return null;

    const speed = bytesTransferred / elapsed;
    const eta = (totalBytes - bytesTransferred) / speed;

    return {
      speedStr: this.displayFileSize(speed) + "/s",
      etaStr: this.formatTime(eta),
    };
  }

  handleIncomingData(data) {
    if (!this.receiveBuffer) this.receiveBuffer = [];
    this.receiveBuffer.push(data);
    if (!this.isProcessingReceive) {
      this.isProcessingReceive = true;
      Promise.resolve().then(() => this.processReceiveBuffer());
    }
  }

  async processReceiveBuffer() {
    while (this.receiveBuffer && this.receiveBuffer.length > 0) {
      const data = this.receiveBuffer.shift();
      if (typeof data === "string") {
        await this.processControlInstruction(data);
      } else {
        await this.processIncomingChunk(data);
      }
    }
    this.isProcessingReceive = false;
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
        case "done":
          await this.finalizeIncomingFile();
          this.isReceiving = false;
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
    if (this.receivedBatch.length > 1) {
      this.createBatchZipButton([...this.receivedBatch]);
    }
    this.receivedBatch = [];

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
      this.totalBatchBytesReceived = 0;
      this.receivedBatchStartTime = Date.now();

      this.totalPausedTimeReceived = 0;
      this.currentPauseStartReceived = 0;

      uiManager.resetReceivedProgressOnly();
      uiManager.updateReceivedStats("-", "-");
    }

    this.receivedFileDetails = {
      fileName: info.fileName,
      fileSize: info.fileSize,
      batchIndex: info.batchIndex || 1,
      batchTotal: info.batchTotal || 1,
      totalBatchSize: info.totalBatchSize || info.fileSize,
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

    await this.initializeOPFSForIncomingFile(info.fileName);
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

    let fileBlob;
    let fileHandle = null;

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

    currentChunks = null;

    this.receivedBatch.push({
      name: currentDetails.fileName,
      blob: fileBlob,
      opfsHandle: fileHandle,
    });

    const { wrapperDiv } = this.createHistoryEntry({
      name: currentDetails.fileName,
      size: currentDetails.fileSize,
      direction: "from",
      blob: fileBlob,
      opfsHandle: fileHandle,
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
      this.receivedCleanupTimer = setTimeout(() => {
        this.insertHistoryEntry(
          this.incomingFilesContainer,
          this.incomingSectionDiv,
          wrapperDiv,
        );

        if (this.receivedBatch.length > 1) {
          this.createBatchZipButton([...this.receivedBatch]);
        }
        this.receivedBatch = [];
        this.toggleClearHistoryOption();

        uiManager.resetReceivedTransferUI();
        this.totalBatchBytesReceived = 0;
      }, 600);
    } else {
      this.insertHistoryEntry(
        this.incomingFilesContainer,
        this.incomingSectionDiv,
        wrapperDiv,
      );
      this.toggleClearHistoryOption();
    }

    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
  }

  createBatchZipButton(files) {
    const btnContainer = document.createElement("div");
    btnContainer.className = "batch-zip-container";

    const btn = document.createElement("button");
    btn.className = "zip-download-btn";

    const totalItems =
      this.incomingFilesContainer.querySelectorAll("div").length;

    const count = files.length;
    const zipIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 5px; margin-bottom: 2px;"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`;

    if (totalItems > count) {
      btn.innerHTML = `${zipIcon} Download Last ${count} Files (ZIP)`;
    } else {
      btn.innerHTML = `${zipIcon} Download ${count} Files (ZIP)`;
    }

    btn.addEventListener("click", () => {
      this.downloadSpecificBatch(files);
    });

    btnContainer.appendChild(btn);

    if (this.incomingFilesContainer.firstChild) {
      this.incomingFilesContainer.insertBefore(
        btnContainer,
        this.incomingFilesContainer.firstChild,
      );
    } else {
      this.incomingFilesContainer.appendChild(btnContainer);
    }
  }

  async downloadSpecificBatch(files) {
    if (!files || files.length === 0 || !window.JSZip) return;

    const zip = new JSZip();
    files.forEach((file) => {
      zip.file(file.name, file.blob);
    });

    try {
      const content = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });
      const blobUrl = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `batch_${files.length}_files_${new Date().getTime()}.zip`;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 100);
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

  recordSentFile(fileObj) {
    const { wrapperDiv } = this.createHistoryEntry({
      name: fileObj.name,
      size: fileObj.size,
      direction: "to",
    });

    this.insertHistoryEntry(
      this.outgoingFilesContainer,
      this.outgoingSectionDiv,
      wrapperDiv,
    );
    this.toggleClearHistoryOption();
  }

  toggleClearHistoryOption() {
    let eraseHistoryBtn = document.getElementById("erase-history-btn");
    if (!eraseHistoryBtn) {
      eraseHistoryBtn = document.createElement("button");
      eraseHistoryBtn.id = "erase-history-btn";
      eraseHistoryBtn.className = "erase-history-btn";
      eraseHistoryBtn.textContent = "Clear History";
      eraseHistoryBtn.addEventListener("click", () => {
        this.revokeAllBlobUrls();

        this.outgoingFilesContainer.innerHTML = "";
        this.incomingFilesContainer.innerHTML = "";
        this.transferHistoryDiv.style.display = "none";
        this.outgoingSectionDiv.style.display = "none";
        this.incomingSectionDiv.style.display = "none";
        eraseHistoryBtn.remove();
      });
      this.eraseHistoryContainer.appendChild(eraseHistoryBtn);
    }
    this.transferHistoryDiv.style.display = "block";
    eraseHistoryBtn.style.display = "inline-block";
  }

  cleanupSentTransfer() {
    this.isSending = false;
    this.isPaused = false;

    if (this.sentCleanupTimer) {
      clearTimeout(this.sentCleanupTimer);
      this.sentCleanupTimer = null;
    }

    uiManager.resetSentTransferUI();
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;

    this.totalPausedTimeSent = 0;
    this.currentPauseStartSent = 0;
  }

  async cleanupReceivedTransfer() {
    this.isReceiving = false;
    this.isPaused = false;
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receiveBuffer = [];
    this.receivedBytes = 0;
    this.totalBatchBytesReceived = 0;

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

  clearHistory() {
    this.revokeAllBlobUrls();

    if (this.outgoingFilesContainer) this.outgoingFilesContainer.innerHTML = "";
    if (this.incomingFilesContainer) this.incomingFilesContainer.innerHTML = "";
    if (this.transferHistoryDiv) this.transferHistoryDiv.style.display = "none";
    if (this.outgoingSectionDiv) this.outgoingSectionDiv.style.display = "none";
    if (this.incomingSectionDiv) this.incomingSectionDiv.style.display = "none";

    const eraseBtn = document.getElementById("erase-history-btn");
    if (eraseBtn) eraseBtn.remove();

    const zipBtn = document.getElementById("zip-btn-container");
    if (zipBtn) zipBtn.innerHTML = "";
  }
}

const fileTransferManager = new FileTransferManager();
window.fileTransferManager = fileTransferManager;
