// Manages UI updates
class UIManager {
  constructor() {
    this.idMsgTimer = null;
    this.newIdAlertTimer = null;
    this.fileMsgTimer = null;

    this.statusIdMessage = document.getElementById("status-id-message");
    this.activeConnectionContainer = document.getElementById(
      "active-connection-container"
    );
    this.activeConnectionLabel = document.getElementById(
      "active-connection-label"
    );
    this.activeConnectionStatus = document.getElementById(
      "active-connection-status"
    );
    this.endBtn = document.getElementById("end-btn");
    this.fileTransferSection = document.getElementById("file-transfer-section");
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

    this.initializeTemplates();
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

  showFileAlert(message) {
    clearTimeout(this.fileMsgTimer);
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
    this.fileStatusMessage.textContent = message;
    this.fileStatusMessage.style.display = "inline-block";
    this.fileStatusMessage.style.border = "1.5px solid red";
    this.fileStatusMessage.style.color = "red";
    this.fileStatusMessage.style.padding = "1px 2px";
    this.fileMsgTimer = setTimeout(() => this.clearFileAlert(), ALERT_TIMEOUT);
  }

  clearFileAlert() {
    clearTimeout(this.fileMsgTimer);
    this.fileStatusMessage.textContent = "";
    this.fileStatusMessage.style.display = "none";
    this.fileStatusMessage.style.border = "";
    this.fileStatusMessage.style.color = "";
    this.fileStatusMessage.style.padding = "";
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

  updateToIdle() {
    this.clearFileAlert();
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
    this.activeConnectionContainer.style.display = "none";
    this.activeConnectionStatus.textContent = "";
    this.endBtn.style.display = "none";
    this.fileTransferSection.style.display = "none";

    this.resetSentTransferUI();
    this.resetReceivedTransferUI();
  }

  updateToWaiting() {
    this.resetSentTransferUI();
    this.resetReceivedTransferUI();

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
    this.resetSentTransferUI();
    this.resetReceivedTransferUI();

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

    this.resetSentTransferUI();
    this.resetReceivedTransferUI();

    this.activeConnectionContainer.style.display = "flex";
    this.activeConnectionLabel.textContent = "Connected to:";
    this.activeConnectionStatus.textContent = peerId;
    this.activeConnectionStatus.style.textDecoration = "underline";
    this.activeConnectionStatus.style.textDecorationColor = "#27ae60";
    this.activeConnectionStatus.style.textDecorationThickness = "3px";
    this.endBtn.textContent = "Disconnect";
    this.endBtn.style.display = "inline-block";
    this.fileTransferSection.style.display = "block";

    this.newIdAlertTimer = setTimeout(() => {
      this.activeConnectionStatus.style.textDecoration = "";
      this.activeConnectionStatus.style.textDecorationColor = "";
      this.activeConnectionStatus.style.textDecorationThickness = "";
    }, ID_UNDERLINE_TIMEOUT);
  }
}

const uiManager = new UIManager();
