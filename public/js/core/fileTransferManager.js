// Manages file transfers
class FileTransferManager {
  constructor() {
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.fileMsgTimer = null;
    this.isSending = false;
    this.isReceiving = false;
    this.isStopped = false; // Flag to stop transfers
    this.isPaused = false;
    this.receivedCleanupTimer = null;

    this.selectedFiles = []; // Store multiple files
    this.receivedBatch = []; // For ZIP functionality

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
    // Browse Buttons
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

    // Input Changes
    this.uploadField.addEventListener("change", () =>
      this.handleFileSelection(this.uploadField.files),
    );
    if (this.folderUploadField) {
      this.folderUploadField.addEventListener("change", () =>
        this.handleFileSelection(this.folderUploadField.files),
      );
    }

    // Drag & Drop
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
  }

  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    this.handleFileSelection(files);
  }

  handleFileSelection(files) {
    if (files.length > 0) {
      const MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
      const validFiles = [];
      const skippedFiles = [];

      Array.from(files).forEach((file) => {
        if (file.size === 0 || file.size > MAX_SIZE) {
          skippedFiles.push(file.name);
        } else {
          validFiles.push(file);
        }
      });

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
        // If all skipped
        this.fileNameDisplay.textContent = "";
      }

      this.fileTransferBtn.disabled =
        this.selectedFiles.length === 0 ||
        !webrtcManager.dataChannel ||
        webrtcManager.dataChannel.readyState !== "open";
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

    // Iterate and send each file sequentially
    for (let i = 0; i < this.selectedFiles.length; i++) {
      // STOP CHECK: If stopped, do not proceed to next file
      if (this.isStopped) break;

      const fileToSend = this.selectedFiles[i];

      // Update UI to show which file is sending
      uiManager.ensureSentContainer();

      // Reset bar to 0% first
      uiManager.resetSentProgressOnly();
      // Initialize stats to "Calculating..." immediately
      uiManager.updateSentStats("-", "-");

      const startMsg =
        this.selectedFiles.length > 1
          ? `Sending file ${i + 1}/${this.selectedFiles.length}: ${fileToSend.name}`
          : `Sending file: ${fileToSend.name}`;
      uiManager.transferStatusDivSent.textContent = startMsg;

      // Send metadata
      webrtcManager.dataChannel.send(
        JSON.stringify({
          type: "metadata",
          fileName: fileToSend.name,
          fileSize: fileToSend.size,
          batchIndex: i + 1,
          batchTotal: this.selectedFiles.length,
        }),
      );

      // Wait for file to send before moving to next
      try {
        await this.sendFileSlicesPromise(
          fileToSend,
          i + 1,
          this.selectedFiles.length,
        );
      } catch (err) {
        console.warn("Transfer aborted or failed:", err);
        break;
      }

      // STOP CHECK: Check again after file 'finished' (or stopped mid-way)
      if (this.isStopped) break;

      // Removed extra delay loop here to reduce "dead space".
      // rely on the 500ms delay inside sendFileSlicesPromise for pacing.
    }

    const wasStopped = this.isStopped;

    // Ensure button is re-enabled even if stopped
    this.fileTransferBtn.disabled = false;

    // Reset stop flag for next time
    this.isStopped = false;
    this.isPaused = false;

    // Only clear if successful and not stopped
    if (this.selectedFiles.length > 0 && !wasStopped && this.isSending) {
      uiManager.updateSentProgressBarValue(100);

      // Hide UI immediately after the last file's individual 500ms wait
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
    // Abort ongoing transfer
    this.isStopped = true;
    this.isPaused = false;

    // Control message to receiver
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

    // Update UI
    uiManager.updateSentStats("-", "-");

    // Clear immediatley to match receiver's behavior on stop
    uiManager.resetSentTransferUI();
  }

  updateFileSelectionUI() {
    // Helper to clear the text if array is empty
    if (this.selectedFiles.length === 0 && this.fileNameDisplay) {
      this.fileNameDisplay.textContent = "";
    }
  }

  async sendFileSlicesPromise(fileObj, currentIdx, totalCount) {
    if (this.isStopped) return Promise.resolve(); // Skip if stopped

    this.isSending = true;
    let startTime = Date.now();
    let lastUIUpdate = 0;

    return new Promise((resolve, reject) => {
      let offset = 0;
      const reader = new FileReader();

      reader.onload = async (evt) => {
        // Check for Stop Flag
        if (this.isStopped) {
          this.cleanupSentTransfer();
          resolve();
          return;
        }

        // Check for Pause (but not for very small files < 1MB to avoid glitches)
        const MIN_PAUSE_SIZE = 1024 * 1024; // 1MB
        while (this.isPaused && fileObj.size > MIN_PAUSE_SIZE) {
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

        while (webrtcManager.dataChannel.bufferedAmount > 65535) {
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

        // Throttle UI Updates (e.g., every 100ms)
        const now = Date.now();
        if (now - lastUIUpdate > 100 || offset === fileObj.size) {
          // Ensure UI is visible!
          uiManager.ensureSentContainer();
          uiManager.updateSentProgressBarValue(
            Math.floor((offset / fileObj.size) * 100),
          );

          // Speed/ETA Calculation
          const elapsed = (now - startTime) / 1000; // seconds
          if (elapsed > 0.5) {
            const speed = offset / elapsed; // bytes per second
            const remainingBytes = fileObj.size - offset;
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
          // File done - matching format with receiver
          const doneMsg =
            totalCount > 1
              ? `Sent file ${currentIdx}/${totalCount}: ${fileObj.name}`
              : `Sent file: ${fileObj.name}`;

          uiManager.transferStatusDivSent.textContent = doneMsg;

          webrtcManager.dataChannel.send(JSON.stringify({ type: "done" }));
          this.recordSentFile(fileObj);

          // Wait 500ms at filled state ONLY if more files are coming or to match receiver
          await new Promise((r) => setTimeout(r, 500));

          // Reset Progress Bar
          uiManager.updateSentProgressBarValue(0);
          uiManager.updateSentStats("-", "-");

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

  // Legacy method kept for safety, but sendFileSlicesPromise is used now
  async sendFileSlices(fileObj) {
    return this.sendFileSlicesPromise(fileObj, 1, 1);
  }

  processControlInstruction(input) {
    try {
      const info = JSON.parse(input);
      if (info.type === "metadata") {
        // Clear any pending cleanup from previous files to prevent UI flickering
        if (this.receivedCleanupTimer) {
          clearTimeout(this.receivedCleanupTimer);
          this.receivedCleanupTimer = null;
        }

        // Detect new batch starting: index is 1. If we have leftover files from a previous (cancelled) batch, clear them.
        if (info.batchIndex === 1 && this.receivedBatch.length > 0) {
          this.receivedBatch = [];
        }

        this.receivedFileDetails = {
          fileName: info.fileName,
          fileSize: info.fileSize,
          batchIndex: info.batchIndex || 1,
          batchTotal: info.batchTotal || 1,
          startTime: Date.now(),
        };
        this.collectedChunks = [];
        this.receivedBytes = 0;
        this.isReceiving = true;

        uiManager.ensureReceivedContainer();
        uiManager.resetReceivedProgressOnly(); 
        uiManager.updateReceivedStats("...", "-"); // Explicitly set "Calculating..." at start

        const batchMsg =
          info.batchTotal > 1
            ? `Receiving file ${info.batchIndex}/${info.batchTotal}: ${info.fileName}`
            : `Receiving file: ${info.fileName}`;
        uiManager.transferStatusDivReceived.textContent = batchMsg;
      } else if (info.type === "done") {
        this.finalizeIncomingFile();
        this.isReceiving = false;
      } else if (info.type === "cancel-transfer") {
        // If we have received > 1 files in this interrupted batch, create a partial zip for them.
        if (this.receivedBatch.length > 1) {
          this.createBatchZipButton([...this.receivedBatch]);
        }
        this.receivedBatch = []; // Clear current batch so it doesn't mix with next one

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

    // Ensure UI exists before updating
    if (
      !uiManager.transferStatusDivReceived ||
      !uiManager.transferStatusDivReceived.isConnected
    ) {
      uiManager.ensureReceivedContainer();
      const batchMsg =
        this.receivedFileDetails.batchTotal > 1
          ? `Receiving file ${this.receivedFileDetails.batchIndex}/${this.receivedFileDetails.batchTotal}: ${this.receivedFileDetails.fileName}`
          : `Receiving file: ${this.receivedFileDetails.fileName}`;
      uiManager.transferStatusDivReceived.textContent = batchMsg;
    }

    uiManager.updateReceivedProgressBarValue(
      Math.floor(
        (this.receivedBytes / this.receivedFileDetails.fileSize) * 100,
      ),
    );

    // Stats
    const now = Date.now();
    const elapsed = (now - this.receivedFileDetails.startTime) / 1000;
    if (elapsed > 0.5) {
      const speed = this.receivedBytes / elapsed;
      const remaining = this.receivedFileDetails.fileSize - this.receivedBytes;
      const eta = remaining / speed;
      uiManager.updateReceivedStats(
        this.displayFileSize(speed) + "/s",
        this.formatTime(eta),
      );
    }
  }

  finalizeIncomingFile() {
    const fileBlob = new Blob(this.collectedChunks);
    this.receivedBatch.push({
      name: this.receivedFileDetails.fileName,
      blob: fileBlob,
    });

    // Create download link for individual file
    const link = document.createElement("a");
    link.href = URL.createObjectURL(fileBlob);
    link.download = this.receivedFileDetails.fileName;
    link.textContent = this.receivedFileDetails.fileName;
    link.style.fontWeight = "bold";

    const metaSpan = document.createElement("span");
    const peerName = uiManager.getNickname
      ? uiManager.getNickname(webrtcManager.activePeerId)
      : webrtcManager.activePeerId;
    const peerDisplay =
      peerName === webrtcManager.activePeerId
        ? peerName
        : `${peerName} (${webrtcManager.activePeerId})`;

    metaSpan.textContent = ` size: ${this.displayFileSize(
      this.receivedFileDetails.fileSize,
    )}, from: ${peerDisplay}, at: ${new Date().toLocaleTimeString()}`;

    // Minimalist styling
    metaSpan.style.fontSize = "0.75rem";
    metaSpan.style.fontStyle = "italic";
    metaSpan.style.color = "#888";
    metaSpan.style.marginLeft = "8px";

    const wrapperDiv = document.createElement("div");
    wrapperDiv.style.padding = "4px 0";
    wrapperDiv.appendChild(link);
    wrapperDiv.appendChild(metaSpan);

    if (this.incomingFilesContainer.firstChild) {
      this.incomingFilesContainer.insertBefore(
        wrapperDiv,
        this.incomingFilesContainer.firstChild,
      );
    } else {
      this.incomingSectionDiv.style.display = "block";
      this.incomingFilesContainer.appendChild(wrapperDiv);
    }

    // Check if batch is complete
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

    const doneMsg =
      this.receivedFileDetails.batchTotal > 1
        ? `Received file ${this.receivedFileDetails.batchIndex}/${this.receivedFileDetails.batchTotal}: ${this.receivedFileDetails.fileName}`
        : `Received file: ${this.receivedFileDetails.fileName}`;
    uiManager.transferStatusDivReceived.textContent = doneMsg;

    uiManager.updateReceivedStats("-", "-");

    this.receivedCleanupTimer = setTimeout(
      () => uiManager.resetReceivedTransferUI(),
      500,
    );

    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
  }

  createBatchZipButton(files) {
    const btnContainer = document.createElement("div");
    btnContainer.className = "batch-zip-container";

    const btn = document.createElement("button");
    btn.className = "zip-download-btn";

    // Calculate total files visible in container to give context
    // Note: container includes previous files and previous Zip buttons/wrappers.
    // We know `files` is the batch we just received.
    // If there are more files in the DOM than just this batch, say "Last N Files".
    // Each file is in a div wrapper.
    const totalItems =
      this.incomingFilesContainer.querySelectorAll("div").length;
    // We just added `files.length` items.
    // If totalItems > files.length, then there is history.

    const count = files.length;
    if (totalItems > count) {
      btn.innerHTML = `📦 Download Last ${count} Files (ZIP)`;
    } else {
      btn.innerHTML = `📦 Download ${count} Files (ZIP)`;
    }

    // Styles moved to CSS class 'zip-download-btn' in style.css
    // to support light/dark mode switching properly.

    btn.addEventListener("click", () => this.downloadSpecificBatch(files));

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
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = `batch_${files.length}_files_${new Date().getTime()}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
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
    const nameSpan = document.createElement("span");
    nameSpan.textContent = fileObj.name;
    nameSpan.style.fontWeight = "bold";

    const metaSpan = document.createElement("span");
    const peerName = uiManager.getNickname
      ? uiManager.getNickname(webrtcManager.activePeerId)
      : webrtcManager.activePeerId;
    const peerDisplay =
      peerName === webrtcManager.activePeerId
        ? peerName
        : `${peerName} (${webrtcManager.activePeerId})`;

    metaSpan.textContent = ` size: ${this.displayFileSize(
      fileObj.size,
    )}, to: ${peerDisplay}, at: ${new Date().toLocaleTimeString()}`;

    // Minimalist styling similar to chat timestamps
    metaSpan.style.fontSize = "0.75rem";
    metaSpan.style.fontStyle = "italic";
    metaSpan.style.color = "#888";
    metaSpan.style.marginLeft = "8px";

    const wrapperDiv = document.createElement("div");
    wrapperDiv.style.padding = "4px 0";
    wrapperDiv.appendChild(nameSpan);
    wrapperDiv.appendChild(metaSpan);

    if (this.outgoingFilesContainer.firstChild) {
      this.outgoingFilesContainer.insertBefore(
        wrapperDiv,
        this.outgoingFilesContainer.firstChild,
      );
    } else {
      this.outgoingSectionDiv.style.display = "block";
      this.outgoingFilesContainer.appendChild(wrapperDiv);
    }
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
        Array.from(this.outgoingFilesContainer.querySelectorAll("a")).forEach(
          (link) => {
            URL.revokeObjectURL(link.href);
          },
        );
        Array.from(this.incomingFilesContainer.querySelectorAll("a")).forEach(
          (link) => {
            URL.revokeObjectURL(link.href);
          },
        );
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
    // Clears both lists and the internal memory references
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
