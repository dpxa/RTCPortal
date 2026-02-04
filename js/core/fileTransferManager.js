class FileTransferManager {
  constructor() {
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.fileMsgTimer = null;
    this.isSending = false;
    this.isReceiving = false;
    this.isStopped = false;
    this.isPaused = false;
    this.receivedCleanupTimer = null;

    this.selectedFiles = [];
    this.receivedBatch = [];

    this.activeBlobUrls = new Set();

    this.initializeElements();
    this.initializeEventListeners();
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

  updateTransferButtonState() {
    this.fileTransferBtn.disabled =
      this.selectedFiles.length === 0 ||
      !webrtcManager.dataChannel ||
      webrtcManager.dataChannel.readyState !== "open" ||
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
      metaSpan.style.color = mt ? mt.trim() : "#888";
    } catch (e) {
      metaSpan.style.color = "#888";
    }
    metaSpan.style.marginLeft = "8px";
    return metaSpan;
  }

  createHistoryEntry({ name, size, direction, blob }) {
    const wrapperDiv = document.createElement("div");
    wrapperDiv.style.padding = "4px 0";

    const label = blob
      ? document.createElement("a")
      : document.createElement("span");
    if (blob) {
      const blobUrl = URL.createObjectURL(blob);
      label.href = blobUrl;
      label.download = name;
      this.activeBlobUrls.add(blobUrl);
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

  filterValidFiles(files) {
    const MAX_SIZE = 2 * 1024 * 1024 * 1024;
    const validFiles = [];
    const skippedFiles = [];

    Array.from(files).forEach((file) => {
      if (file.size === 0 || file.size > MAX_SIZE) {
        skippedFiles.push(file.name);
      } else {
        validFiles.push(file);
      }
    });

    return { validFiles, skippedFiles };
  }

  revokeAllBlobUrls() {
    this.activeBlobUrls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.activeBlobUrls.clear();
  }

  handleFileSelection(files) {
    if (files.length > 0) {
      const { validFiles, skippedFiles } = this.filterValidFiles(files);

      if (skippedFiles.length > 0) {
        console.warn("Skipped files:", skippedFiles);
        uiManager.showFileWarning(
          `Skipped ${skippedFiles.length} files (empty or > 2GB).`,
        );
      }

      this.selectedFiles = validFiles;

      const totalSize = this.selectedFiles.reduce(
        (acc, file) => acc + file.size,
        0,
      );

      if (this.selectedFiles.length === 1) {
        this.fileNameDisplay.textContent = `Selected: ${this.selectedFiles[0].name} (${this.displayFileSize(this.selectedFiles[0].size)})`;
      } else if (this.selectedFiles.length > 1) {
        this.fileNameDisplay.textContent = `Selected: ${this.selectedFiles.length} files (${this.displayFileSize(totalSize)})`;
      } else {
        this.fileNameDisplay.textContent = "";
      }

      this.updateTransferButtonState();
    } else {
      this.selectedFiles = [];
      this.fileNameDisplay.textContent = "";
      this.fileTransferBtn.disabled = true;
    }
  }

  async sendFile() {
    if (
      !webrtcManager.dataChannel ||
      webrtcManager.dataChannel.readyState !== "open"
    ) {
      uiManager.showFileAlert("Data channel not open! Ending connection...");
      setTimeout(() => {
        webrtcManager.resetCurrentConnection();
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

      uiManager.transferStatusDivSent.textContent = this.formatBatchMessage(
        "Sending",
        i + 1,
        this.selectedFiles.length,
        fileToSend.name,
      );

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

    if (this.selectedFiles.length > 0 && !wasStopped && this.isSending) {
      uiManager.updateSentProgressBarValue(100);

      uiManager.resetSentTransferUI();
    }
  }

  togglePause() {
    if (!this.isSending) return;
    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      if (uiManager.pauseTransferBtn)
        uiManager.pauseTransferBtn.textContent = "Resume";
      uiManager.transferStatusDivSent.textContent = "Transfer Paused";
    } else {
      if (uiManager.pauseTransferBtn)
        uiManager.pauseTransferBtn.textContent = "Pause";
      uiManager.transferStatusDivSent.textContent = "Resuming...";
    }
  }

  stopTransfer() {
    this.isStopped = true;
    this.isPaused = false;

    if (
      webrtcManager.dataChannel &&
      webrtcManager.dataChannel.readyState === "open"
    ) {
      webrtcManager.dataChannel.send(
        JSON.stringify({ type: "cancel-transfer" }),
      );
    }

    this.isSending = false;
    this.fileTransferBtn.disabled = false;

    uiManager.updateSentStats("-", "-");

    uiManager.resetSentTransferUI();
  }

  updateFileSelectionUI() {
    if (this.selectedFiles.length === 0 && this.fileNameDisplay) {
      this.fileNameDisplay.textContent = "";
    }
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
          await new Promise((r) => setTimeout(r, 200));
        }

        if (
          !this.isSending ||
          !webrtcManager.dataChannel ||
          webrtcManager.dataChannel.readyState !== "open"
        ) {
          this.cleanupSentTransfer();
          reject("Transfer aborted");
          return;
        }

        const chunk = evt.target.result;

        while (
          webrtcManager.dataChannel.bufferedAmount > 65535 ||
          this.isPaused
        ) {
          await new Promise((r) => setTimeout(r, 100));

          if (this.isStopped) {
            this.cleanupSentTransfer();
            resolve();
            return;
          }

          if (
            !this.isSending ||
            !webrtcManager.dataChannel ||
            webrtcManager.dataChannel.readyState !== "open"
          ) {
            this.cleanupSentTransfer();
            reject("Transfer aborted");
            return;
          }
        }
        webrtcManager.dataChannel.send(chunk);

        offset += chunk.byteLength;

        const now = Date.now();
        if (now - lastUIUpdate > 100 || offset === fileObj.size) {
          uiManager.ensureSentContainer();

          const currentTotalSent = totalBytesSentStart + offset;
          const totalSize = totalBatchSize || fileObj.size;
          uiManager.updateSentProgressBarValue(
            Math.floor((currentTotalSent / totalSize) * 100),
          );

          const elapsed = (now - batchStartTime) / 1000;
          if (elapsed > 0.5) {
            const speed = currentTotalSent / elapsed;
            const remainingBytes = totalSize - currentTotalSent;
            const eta = remainingBytes / speed;
            uiManager.updateSentStats(
              this.displayFileSize(speed) + "/s",
              this.formatTime(eta),
            );
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
          this.recordSentFile(fileObj);

          if (currentIdx === totalCount) {
            await new Promise((r) => setTimeout(r, 500));
            uiManager.updateSentStats("-", "-");
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

  async sendFileSlices(fileObj) {
    return this.sendFileSlicesPromise(fileObj, 1, 1);
  }

  processControlInstruction(input) {
    try {
      const info = JSON.parse(input);
      if (info.type === "metadata") {
        if (this.receivedCleanupTimer) {
          clearTimeout(this.receivedCleanupTimer);
          this.receivedCleanupTimer = null;
        }

        if (info.batchIndex === 1 && this.receivedBatch.length > 0) {
          this.receivedBatch = [];
        }

        if (
          info.batchIndex === 1 ||
          typeof this.totalBatchBytesReceived === "undefined"
        ) {
          this.totalBatchBytesReceived = 0;
          this.receivedBatchStartTime = Date.now();
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

        uiManager.ensureReceivedContainer();
        if (info.batchIndex === 1) {
          uiManager.resetReceivedProgressOnly();
          uiManager.updateReceivedStats("...", "-");
        }

        uiManager.transferStatusDivReceived.textContent =
          this.formatBatchMessage(
            "Receiving",
            info.batchIndex,
            info.batchTotal,
            info.fileName,
          );
      } else if (info.type === "done") {
        this.finalizeIncomingFile();
        this.isReceiving = false;
      } else if (info.type === "cancel-transfer") {
        if (this.receivedBatch.length > 1) {
          this.createBatchZipButton([...this.receivedBatch]);
        }
        this.receivedBatch = [];

        this.cleanupReceivedTransfer();
        uiManager.showFileWarning("Sender cancelled transfer.");
      }
    } catch (err) {
      console.log("Received text message:", input);
    }
  }

  processIncomingChunk(arrayBuffer) {
    if (!this.receivedFileDetails) return;
    this.collectedChunks.push(arrayBuffer);
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
      uiManager.updateReceivedProgressBarValue(
        Math.floor((this.totalBatchBytesReceived / totalSize) * 100),
      );

      const elapsed = (now - this.receivedBatchStartTime) / 1000;
      if (elapsed > 0.5) {
        const speed = this.totalBatchBytesReceived / elapsed;
        const remaining = totalSize - this.totalBatchBytesReceived;
        const eta = remaining / speed;
        uiManager.updateReceivedStats(
          this.displayFileSize(speed) + "/s",
          this.formatTime(eta),
        );
      }
      this.lastReceivedUIUpdate = now;
    }
  }

  finalizeIncomingFile() {
    const fileBlob = new Blob(this.collectedChunks);
    this.receivedBatch.push({
      name: this.receivedFileDetails.fileName,
      blob: fileBlob,
    });

    const { wrapperDiv } = this.createHistoryEntry({
      name: this.receivedFileDetails.fileName,
      size: this.receivedFileDetails.fileSize,
      direction: "from",
      blob: fileBlob,
    });

    this.insertHistoryEntry(
      this.incomingFilesContainer,
      this.incomingSectionDiv,
      wrapperDiv,
    );

    if (
      this.receivedFileDetails.batchIndex ===
      this.receivedFileDetails.batchTotal
    ) {
      if (this.receivedBatch.length > 1) {
        this.createBatchZipButton([...this.receivedBatch]);
      }
      this.receivedBatch = [];
    }

    this.toggleClearHistoryOption();

    uiManager.transferStatusDivReceived.textContent = this.formatBatchMessage(
      "Received",
      this.receivedFileDetails.batchIndex,
      this.receivedFileDetails.batchTotal,
      this.receivedFileDetails.fileName,
    );

    uiManager.updateReceivedStats("-", "-");

    if (
      this.receivedFileDetails &&
      this.receivedFileDetails.batchIndex ===
        this.receivedFileDetails.batchTotal
    ) {
      this.receivedCleanupTimer = setTimeout(
        () => uiManager.resetReceivedTransferUI(),
        500,
      );
      this.totalBatchBytesReceived = 0;
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
    if (totalItems > count) {
      btn.innerHTML = `📦 Download Last ${count} Files (ZIP)`;
    } else {
      btn.innerHTML = `📦 Download ${count} Files (ZIP)`;
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
      const content = await zip.generateAsync({ type: "blob" });
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
    uiManager.resetSentTransferUI();
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
  }

  cleanupReceivedTransfer() {
    this.isReceiving = false;
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.totalBatchBytesReceived = 0;
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

  cleanupAllTransfers() {
    this.cleanupSentTransfer();
    this.cleanupReceivedTransfer();
    uiManager.clearFileAlert();
    clearTimeout(this.fileMsgTimer);
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
