// Manages file transfers
class FileTransferManager {
  constructor() {
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.fileMsgTimer = null;
    this.isTransferActive = false;

    this.initializeElements();
    this.initializeEventListeners();
  }

  initializeElements() {
    this.uploadField = document.getElementById("upload-field");
    this.fileTransferBtn = document.getElementById("file-transfer-btn");
    this.fileStatusMessage = document.getElementById("file-status-message");
    this.outgoingSectionDiv = document.getElementById("outgoing-section");
    this.incomingSectionDiv = document.getElementById("incoming-section");
    this.transferHistoryDiv = document.getElementById("transfer-history");
    this.outgoingFilesContainer = document.getElementById("outgoing-files");
    this.incomingFilesContainer = document.getElementById("incoming-files");
    this.eraseHistoryContainer = document.querySelector(
      ".erase-history-container"
    );
  }

  initializeEventListeners() {
    this.uploadField.addEventListener("input", () => {
      const selectedFile = this.uploadField.files[0];
      if (selectedFile.size === 0) {
        uiManager.showFileAlert("Cannot send. File is Empty.");
        return;
      }

      this.fileTransferBtn.disabled =
        this.uploadField.value.trim() === "" ||
        !webrtcManager.dataChannel ||
        webrtcManager.dataChannel.readyState !== "open";
    });

    this.fileTransferBtn.addEventListener("click", () => this.sendFile());
  }

  sendFile() {
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
    uiManager.clearFileAlert();

    const selectedFile = this.uploadField.files[0];
    webrtcManager.dataChannel.send(
      JSON.stringify({
        type: "metadata",
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
      })
    );
    this.sendFileSlices(selectedFile);
  }

  async sendFileSlices(fileObj) {
    this.fileTransferBtn.disabled = true;
    this.isTransferActive = true;
    uiManager.ensureSentContainer();
    uiManager.transferStatusDivSent.textContent = "Sending file...";

    let offset = 0;
    const reader = new FileReader();

    reader.onload = async (evt) => {
      if (
        !this.isTransferActive ||
        !webrtcManager.dataChannel ||
        webrtcManager.dataChannel.readyState !== "open"
      ) {
        this.cleanupSentTransfer();
        return;
      }

      const chunk = evt.target.result;

      while (webrtcManager.dataChannel.bufferedAmount > 65535) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (
          !this.isTransferActive ||
          !webrtcManager.dataChannel ||
          webrtcManager.dataChannel.readyState !== "open"
        ) {
          this.cleanupSentTransfer();
          return;
        }
      }
      webrtcManager.dataChannel.send(chunk);

      offset += chunk.byteLength;
      uiManager.transferStatusDivSent.textContent = "Sending file...";
      uiManager.updateSentProgressBarValue(
        Math.floor((offset / fileObj.size) * 100)
      );

      if (offset < fileObj.size) {
        readChunk(offset);
      } else {
        this.isTransferActive = false;
        uiManager.transferStatusDivSent.textContent = "File sent!";
        webrtcManager.dataChannel.send(JSON.stringify({ type: "done" }));
        this.recordSentFile(fileObj);
        setTimeout(() => {
          uiManager.resetSentTransferUI();
          this.fileTransferBtn.disabled = false;
        }, 500);
      }
    };

    reader.onerror = (error) => {
      console.error("File read error:", error);
      this.cleanupSentTransfer();
    };

    function readChunk(position) {
      reader.readAsArrayBuffer(fileObj.slice(position, position + SLICE_SIZE));
    }
    readChunk(0);
  }

  processControlInstruction(input) {
    try {
      const info = JSON.parse(input);
      if (info.type === "metadata") {
        this.receivedFileDetails = {
          fileName: info.fileName,
          fileSize: info.fileSize,
        };
        this.collectedChunks = [];
        this.receivedBytes = 0;
        this.isTransferActive = true;

        uiManager.ensureReceivedContainer();
        uiManager.transferStatusDivReceived.textContent = "Receiving file...";
      } else if (info.type === "done") {
        this.finalizeIncomingFile();
        this.isTransferActive = false;
      }
    } catch (err) {
      console.log("Received text message:", input);
    }
  }

  processIncomingChunk(arrayBuffer) {
    if (!this.receivedFileDetails) return;
    this.collectedChunks.push(arrayBuffer);
    this.receivedBytes += arrayBuffer.byteLength;
    uiManager.transferStatusDivReceived.textContent = "Receiving file...";
    uiManager.updateReceivedProgressBarValue(
      Math.floor((this.receivedBytes / this.receivedFileDetails.fileSize) * 100)
    );
  }

  finalizeIncomingFile() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(this.collectedChunks));
    link.download = this.receivedFileDetails.fileName;
    link.textContent = this.receivedFileDetails.fileName;

    const metaSpan = document.createElement("span");
    metaSpan.textContent = ` (size: ${this.displayFileSize(
      this.receivedFileDetails.fileSize
    )}, from: ${
      webrtcManager.activePeerId
    }, at: ${new Date().toLocaleTimeString()})`;

    const wrapperDiv = document.createElement("div");
    wrapperDiv.appendChild(link);
    wrapperDiv.appendChild(metaSpan);

    if (this.incomingFilesContainer.firstChild) {
      this.incomingFilesContainer.insertBefore(
        wrapperDiv,
        this.incomingFilesContainer.firstChild
      );
    } else {
      this.incomingSectionDiv.style.display = "block";
      this.incomingFilesContainer.appendChild(wrapperDiv);
    }
    this.toggleClearHistoryOption();

    uiManager.transferStatusDivReceived.textContent = "File received!";
    setTimeout(() => uiManager.resetReceivedTransferUI(), 500);

    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
  }

  displayFileSize(numBytes) {
    if (numBytes === 0) return "0 Bytes";
    const units = ["Bytes", "KB", "MB", "GB", "TB"];
    const order = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / Math.pow(1024, order)).toFixed(2)} ${units[order]}`;
  }

  recordSentFile(fileObj) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(fileObj);
    link.download = fileObj.name;
    link.textContent = fileObj.name;

    const metaSpan = document.createElement("span");
    metaSpan.textContent = `  (size: ${this.displayFileSize(
      fileObj.size
    )}, to: ${
      webrtcManager.activePeerId
    }, at: ${new Date().toLocaleTimeString()})`;

    const wrapperDiv = document.createElement("div");
    wrapperDiv.appendChild(link);
    wrapperDiv.appendChild(metaSpan);

    if (this.outgoingFilesContainer.firstChild) {
      this.outgoingFilesContainer.insertBefore(
        wrapperDiv,
        this.outgoingFilesContainer.firstChild
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
          }
        );
        Array.from(this.incomingFilesContainer.querySelectorAll("a")).forEach(
          (link) => {
            URL.revokeObjectURL(link.href);
          }
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
    this.isTransferActive = false;
    uiManager.resetSentTransferUI();
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
  }

  cleanupReceivedTransfer() {
    this.isTransferActive = false;
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
    uiManager.resetReceivedTransferUI();
  }

  cleanupAllTransfers() {
    this.cleanupSentTransfer();
    this.cleanupReceivedTransfer();
    uiManager.clearFileAlert();
    clearTimeout(this.fileMsgTimer);
  }
}

const fileTransferManager = new FileTransferManager();
