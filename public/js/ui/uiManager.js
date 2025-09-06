class UIManager {
  constructor() {
    this.idMsgTimer = null;
    this.newIdAlertTimer = null;
    
    // DOM elements
    this.statusIdMessage = document.getElementById("status-id-message");
    this.activeConnectionContainer = document.getElementById("active-connection-container");
    this.activeConnectionLabel = document.getElementById("active-connection-label");
    this.activeConnectionStatus = document.getElementById("active-connection-status");
    this.endBtn = document.getElementById("end-btn");
    this.fileTransferSection = document.getElementById("file-transfer-section");
    this.uploadField = document.getElementById("upload-field");
    this.fileTransferBtn = document.getElementById("file-transfer-btn");
  }

  // change message box above id
  showCopied() {
    clearTimeout(this.idMsgTimer);
    this.statusIdMessage.textContent = "Copied";
    this.statusIdMessage.style.display = "inline-block";
    this.statusIdMessage.style.border = "";
    this.statusIdMessage.style.color = "black";
    this.statusIdMessage.style.padding = "2px 4px 2px 0";
    this.idMsgTimer = setTimeout(() => this.clearAlert(), ALERT_TIMEOUT);
  }

  showIdError(msg) {
    clearTimeout(this.idMsgTimer);
    this.statusIdMessage.textContent = msg;
    this.statusIdMessage.style.display = "inline-block";
    this.statusIdMessage.style.border = "1.5px solid red";
    this.statusIdMessage.style.color = "red";
    this.statusIdMessage.style.padding = "1px 2px";
    this.idMsgTimer = setTimeout(() => this.clearAlert(), ALERT_TIMEOUT);
  }

  clearAlert() {
    clearTimeout(this.idMsgTimer);
    this.statusIdMessage.textContent = "";
    this.statusIdMessage.style.display = "none";
    this.statusIdMessage.style.border = "";
    this.statusIdMessage.style.color = "";
    this.statusIdMessage.style.padding = "";
  }

  // no current connection
  updateToIdle() {
    fileTransferManager.clearAlert();
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
    this.activeConnectionContainer.style.display = "none";
    this.activeConnectionStatus.textContent = "";
    this.endBtn.style.display = "none";
    this.fileTransferSection.style.display = "none";
  }

  // waiting for connection
  updateToWaiting() {
    this.activeConnectionContainer.style.display = "flex";
    this.activeConnectionLabel.textContent = "Waiting for peer...";
    this.activeConnectionStatus.textContent = "";
    this.activeConnectionStatus.style.textDecoration = "";
    this.activeConnectionStatus.style.textDecorationColor = "";
    this.activeConnectionStatus.style.textDecorationThickness = "";
    this.endBtn.textContent = "Cancel";
    this.endBtn.style.display = "inline-block";
  }

  updateToConnectedAfterAbort(peerId) {
    this.activeConnectionContainer.style.display = "flex";
    this.activeConnectionLabel.textContent = "Connected to:";
    this.activeConnectionStatus.textContent = peerId;
    this.endBtn.textContent = "Disconnect";
    this.endBtn.style.display = "inline-block";
    this.fileTransferSection.style.display = "block";
  }

  updateToConnected(peerId) {
    clearTimeout(this.newIdAlertTimer);
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
    this.activeConnectionContainer.style.display = "flex";
    this.activeConnectionLabel.textContent = "Connected to:";
    this.activeConnectionStatus.textContent = peerId;
    this.activeConnectionStatus.style.textDecoration = "underline";
    this.activeConnectionStatus.style.textDecorationColor = "#27ae60";
    this.activeConnectionStatus.style.textDecorationThickness = "3px";
    this.endBtn.textContent = "Disconnect";
    this.endBtn.style.display = "inline-block";
    this.fileTransferSection.style.display = "block";
    
    // briefly underline peer id on connection
    this.newIdAlertTimer = setTimeout(() => {
      this.activeConnectionStatus.style.textDecoration = "";
      this.activeConnectionStatus.style.textDecorationColor = "";
      this.activeConnectionStatus.style.textDecorationThickness = "";
    }, ID_UNDERLINE_TIMEOUT);
  }
}

const uiManager = new UIManager();
