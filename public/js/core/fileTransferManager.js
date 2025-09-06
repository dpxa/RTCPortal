class FileTransferManager {
  constructor() {
    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
    this.fileMsgTimer = null;

    this.initializeElements();
    this.initializeEventListeners();
    this.initializeTemplates();
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

    this.transferStatusDivSent = null;
    this.progressContainerSent = null;
    this.progressBarSent = null;
    this.progressPercentSent = null;

    this.transferStatusDivReceived = null;
    this.progressContainerReceived = null;
    this.progressBarReceived = null;
    this.progressPercentReceived = null;
  }

  initializeTemplates() {
    this.sentTemplateHTML = `
      <div id="sent-container">
        <div id="transfer-status-sent"></div>
        <div class="progress-container" id="sent-progress-container">
          <div class="progress-bar" style="width: 0%; background: #27ae60;"></div>
          <span class="progress-percentage" style="display:none;">0%</span>
        </div>
      </div>
    `;

    this.receivedTemplateHTML = `
      <div id="received-container">
        <div id="transfer-status-received"></div>
        <div class="progress-container" id="received-progress-container">
          <div class="progress-bar" style="width: 0%; background: #4a90e2;"></div>
          <span class="progress-percentage" style="display:none;">0%</span>
        </div>
      </div>
    `;
  }

  initializeEventListeners() {
    this.uploadField.addEventListener("input", () => {
      this.fileTransferBtn.disabled =
        this.uploadField.value.trim() === "" ||
        !webrtcManager.dataChannel ||
        webrtcManager.dataChannel.readyState !== "open";
    });

    this.fileTransferBtn.addEventListener("click", () => this.sendFile());
  }

  showAlert(message) {
    clearTimeout(this.fileMsgTimer);
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
    this.fileStatusMessage.textContent = message;
    this.fileStatusMessage.style.display = "inline-block";
    this.fileStatusMessage.style.border = "1.5px solid red";
    this.fileStatusMessage.style.color = "red";
    this.fileStatusMessage.style.padding = "1px 2px";
    this.fileMsgTimer = setTimeout(() => this.clearAlert(), ALERT_TIMEOUT);
  }

  clearAlert() {
    clearTimeout(this.fileMsgTimer);
    this.fileStatusMessage.textContent = "";
    this.fileStatusMessage.style.display = "none";
    this.fileStatusMessage.style.border = "";
    this.fileStatusMessage.style.color = "";
    this.fileStatusMessage.style.padding = "";
  }

  sendFile() {
    if (
      !webrtcManager.dataChannel ||
      webrtcManager.dataChannel.readyState !== "open"
    ) {
      this.showAlert("Data channel not open! Ending connection...");
      setTimeout(() => {
        webrtcManager.resetCurrentConnection();
      }, 4000);
      return;
    }

    const selectedFile = this.uploadField.files[0];
    if (selectedFile.size === 0) {
      this.showAlert("Cannot send. File is Empty.");
      return;
    }
    this.clearAlert();

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
    this.ensureSentContainer();
    this.transferStatusDivSent.textContent = "Sending file...";

    let offset = 0;
    const reader = new FileReader();

    reader.onload = async (evt) => {
      const chunk = evt.target.result;

      while (webrtcManager.dataChannel.bufferedAmount > 65535) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      webrtcManager.dataChannel.send(chunk);

      offset += chunk.byteLength;
      const pct = Math.floor((offset / fileObj.size) * 100);
      this.transferStatusDivSent.textContent = "Sending file...";
      this.updateSentProgressBarValue(pct);

      if (offset < fileObj.size) {
        readChunk(offset);
      } else {
        this.transferStatusDivSent.textContent = "File sent!";
        webrtcManager.dataChannel.send(JSON.stringify({ type: "done" }));
        this.recordSentFile(fileObj);
        setTimeout(() => {
          this.resetSentTransferUI();
          this.fileTransferBtn.disabled = false;
        }, 500);
      }
    };

    reader.onerror = (error) => {
      console.error("File read error:", error);
      this.resetSentTransferUI();
      this.fileTransferBtn.disabled = false;
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

        this.ensureReceivedContainer();
        this.transferStatusDivReceived.textContent = "Receiving file...";
      } else if (info.type === "done") {
        this.finalizeIncomingFile();
      }
    } catch (err) {
      console.log("Received text message:", input);
    }
  }

  processIncomingChunk(arrayBuffer) {
    if (!this.receivedFileDetails) return;
    this.collectedChunks.push(arrayBuffer);
    this.receivedBytes += arrayBuffer.byteLength;
    const pct = Math.floor(
      (this.receivedBytes / this.receivedFileDetails.fileSize) * 100
    );
    this.transferStatusDivReceived.textContent = "Receiving file...";
    this.updateReceivedProgressBarValue(pct);
  }

  finalizeIncomingFile() {
    const finalBlob = new Blob(this.collectedChunks);
    const downloadURL = URL.createObjectURL(finalBlob);
    const link = document.createElement("a");
    link.href = downloadURL;
    link.download = this.receivedFileDetails.fileName;
    link.textContent = this.receivedFileDetails.fileName;

    const metaSpan = document.createElement("span");
    const now = new Date();
    metaSpan.textContent = ` (size: ${this.displayFileSize(
      this.receivedFileDetails.fileSize
    )}, from: ${webrtcManager.activePeerId}, at: ${now.toLocaleTimeString()})`;

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

    this.transferStatusDivReceived.textContent = "File received!";
    setTimeout(() => this.resetReceivedTransferUI(), 500);

    this.receivedFileDetails = null;
    this.collectedChunks = [];
    this.receivedBytes = 0;
  }

  ensureSentContainer() {
    let container = document.getElementById("sent-container");
    if (!container) {
      const temp = document.createElement("div");
      temp.innerHTML = this.sentTemplateHTML;
      container = temp.firstElementChild;
      this.uploadField.parentNode.appendChild(container);
    }
    this.transferStatusDivSent = container.querySelector(
      "#transfer-status-sent"
    );
    this.progressContainerSent = container.querySelector(
      "#sent-progress-container"
    );
    this.progressBarSent =
      this.progressContainerSent.querySelector(".progress-bar");
    this.progressPercentSent = this.progressContainerSent.querySelector(
      ".progress-percentage"
    );

    this.progressContainerSent.style.display = "block";
    this.progressPercentSent.style.display = "inline-block";
  }

  updateSentProgressBarValue(value) {
    this.progressBarSent.style.width = `${value}%`;
    this.progressPercentSent.textContent = `${value}%`;
  }

  resetSentTransferUI() {
    const container = document.getElementById("sent-container");
    if (container) {
      container.remove();
    }

    this.transferStatusDivSent = null;
    this.progressContainerSent = null;
    this.progressBarSent = null;
    this.progressPercentSent = null;
  }

  ensureReceivedContainer() {
    let container = document.getElementById("received-container");
    if (!container) {
      const temp = document.createElement("div");
      temp.innerHTML = this.receivedTemplateHTML;
      container = temp.firstElementChild;
      this.uploadField.parentNode.appendChild(container);
    }
    this.transferStatusDivReceived = container.querySelector(
      "#transfer-status-received"
    );
    this.progressContainerReceived = container.querySelector(
      "#received-progress-container"
    );
    this.progressBarReceived =
      this.progressContainerReceived.querySelector(".progress-bar");
    this.progressPercentReceived = this.progressContainerReceived.querySelector(
      ".progress-percentage"
    );

    this.progressContainerReceived.style.display = "block";
    this.progressPercentReceived.style.display = "inline-block";
  }

  updateReceivedProgressBarValue(value) {
    this.progressBarReceived.style.width = `${value}%`;
    this.progressPercentReceived.textContent = `${value}%`;
  }

  resetReceivedTransferUI() {
    const container = document.getElementById("received-container");
    if (container) {
      container.remove();
    }
    this.transferStatusDivReceived = null;
    this.progressContainerReceived = null;
    this.progressBarReceived = null;
    this.progressPercentReceived = null;
  }

  displayFileSize(numBytes) {
    if (numBytes === 0) return "0 Bytes";
    const units = ["Bytes", "KB", "MB", "GB", "TB"];
    const order = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / Math.pow(1024, order)).toFixed(2)} ${units[order]}`;
  }

  recordSentFile(fileObj) {
    const fileURL = URL.createObjectURL(fileObj);
    const link = document.createElement("a");
    link.href = fileURL;
    link.download = fileObj.name;
    link.textContent = fileObj.name;

    const metaSpan = document.createElement("span");
    const now = new Date();
    metaSpan.textContent = `  (size: ${this.displayFileSize(
      fileObj.size
    )}, to: ${webrtcManager.activePeerId}, at: ${now.toLocaleTimeString()})`;

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
}

const fileTransferManager = new FileTransferManager();
