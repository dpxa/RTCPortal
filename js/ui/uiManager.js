class UIManager {
  constructor() {
    this.idMsgTimer = null;
    this.newIdAlertTimer = null;
    this.fileMsgTimer = null;

    this.statusIdMessage = document.getElementById("status-id-message");
    this.activeConnectionContainer = document.getElementById(
      "active-connection-container",
    );
    this.activeConnectionLabel = document.getElementById(
      "active-connection-label",
    );
    this.activeConnectionStatus = document.getElementById(
      "active-connection-status",
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
      ".erase-history-container",
    );

    this.chatSection = document.getElementById("chat-section");
    this.chatBox = document.getElementById("chat-box");
    this.chatInput = document.getElementById("chat-input");
    this.chatSendBtn = document.getElementById("send-chat-btn");
    this.toggleChatBtn = document.getElementById("toggle-chat-btn");
    this.chatHistorySection = document.getElementById("chat-history-section");
    this.chatHistoryList = document.getElementById("chat-history-list");
    this.nicknames = {};

    if (this.toggleChatBtn) {
      this.toggleChatBtn.addEventListener("click", () => this.toggleChat());
    }

    if (this.chatSendBtn) {
      this.chatSendBtn.addEventListener("click", () => this.handleSendChat());
    }
    if (this.chatInput) {
      this.chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") this.handleSendChat();
      });
    }

    this.transferStatusDivSent = null;
    this.progressContainerSent = null;
    this.progressBarSent = null;
    this.progressPercentSent = null;

    this.transferStatusDivReceived = null;
    this.progressContainerReceived = null;
    this.progressBarReceived = null;
    this.progressPercentReceived = null;

    this.initializeTemplates();
    this.initializeTheme();
  }

  initializeTheme() {
    this.themeToggleBtn = document.getElementById("theme-toggle");
    if (this.themeToggleBtn) {
      this.themeToggleBtn.addEventListener("click", () => {
        document.body.classList.toggle("dark-mode");
        const isDark = document.body.classList.contains("dark-mode");
        this.themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
      });
    }
  }

  getNickname(peerId) {
    if (!peerId) return "";
    return this.nicknames[peerId] || peerId;
  }

  setNickname(peerId, name) {
    if (!peerId) return;
    if (name && name.trim() !== "") {
      this.nicknames[peerId] = name.trim();
    } else {
      delete this.nicknames[peerId];
    }

    const currentPeerId =
      this.activeConnectionStatus.getAttribute("data-peer-id");
    if (currentPeerId === peerId) {
      this.updatePeerIdentityDisplay(peerId);
    }
  }

  updatePeerIdentityDisplay(peerId) {
    const nickname = this.getNickname(peerId);
    this.activeConnectionStatus.textContent = nickname;

    let idSpan = document.getElementById("peer-id-display-span");
    if (nickname !== peerId) {
      if (!idSpan) {
        idSpan = document.createElement("span");
        idSpan.id = "peer-id-display-span";
        idSpan.style.fontSize = "0.75rem";
        idSpan.style.fontStyle = "italic";
        idSpan.style.color = "#999";
      }
      idSpan.textContent = peerId;

      const editBtn = document.getElementById("edit-nickname-btn");
      if (editBtn && editBtn.parentNode === this.activeConnectionContainer) {
        this.activeConnectionContainer.insertBefore(idSpan, editBtn);
        if (document.body.classList.contains("dark-mode")) {
        }
      } else {
        this.activeConnectionContainer.appendChild(idSpan);
      }
    } else {
      if (idSpan) idSpan.remove();
    }
  }

  initializeTemplates() {
    this.sentTemplateHTML = `
      <div id="sent-container">
        <div id="transfer-status-sent"></div>
        <div class="progress-container" id="sent-progress-container">
          <div class="progress-bar" style="width: 0%; background: #27ae60;"></div>
          <span class="progress-percentage" style="display:none;">0%</span>
        </div>
        <div id="sent-stats" style="font-size: 0.85rem; color: #27ae60; margin-top: 4px; font-family: monospace;"></div>
        <div id="sent-buttons-container" style="margin-top: 8px; display: none;">
            <button id="pause-transfer-btn" style="font-size: 0.8rem; padding: 4px 8px; background-color: #f39c12; border-color: #f39c12;">Pause</button>
            <button id="stop-transfer-btn" style="font-size: 0.8rem; padding: 4px 8px; background-color: #e74c3c; border-color: #e74c3c; margin-left: 5px;">Stop</button>
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
         <div id="received-stats" style="font-size: 0.85rem; color: #4a90e2; margin-top: 4px; font-family: monospace;"></div>
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

  showFileWarning(message) {
    clearTimeout(this.fileMsgTimer);
    this.fileStatusMessage.textContent = message;
    this.fileStatusMessage.style.display = "inline-block";
    this.fileStatusMessage.style.border = "1.5px solid red";
    this.fileStatusMessage.style.color = "red";
    this.fileStatusMessage.style.padding = "1px 2px";
    this.fileMsgTimer = setTimeout(
      () => this.clearFileAlert(),
      ALERT_TIMEOUT + 2000,
    );
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
      this.fileTransferSection.appendChild(container);
    }
    this.transferStatusDivSent = container.querySelector(
      "#transfer-status-sent",
    );
    this.progressContainerSent = container.querySelector(
      "#sent-progress-container",
    );
    this.progressBarSent =
      this.progressContainerSent.querySelector(".progress-bar");
    this.progressPercentSent = this.progressContainerSent.querySelector(
      ".progress-percentage",
    );
    this.sentStatsDiv = container.querySelector("#sent-stats");
    this.sentButtonsContainer = container.querySelector(
      "#sent-buttons-container",
    );
    this.pauseTransferBtn = container.querySelector("#pause-transfer-btn");
    this.stopTransferBtn = container.querySelector("#stop-transfer-btn");

    if (this.pauseTransferBtn) {
      this.pauseTransferBtn.addEventListener("click", () => {
        window.fileTransferManager.togglePause();
      });
    }

    if (this.stopTransferBtn) {
      this.stopTransferBtn.addEventListener("click", () => {
        window.fileTransferManager.stopTransfer();
      });
    }

    this.progressContainerSent.style.display = "block";
    this.sentButtonsContainer.style.display = "block";
    this.progressPercentSent.style.display = "inline-block";
  }

  updateSentProgressBarValue(value) {
    if (this.progressBarSent) {
      this.progressBarSent.style.width = `${value}%`;
    }
    if (this.progressPercentSent) {
      this.progressPercentSent.textContent = `${value}%`;
    }
  }

  updateSentStats(speed, eta) {
    if (!this.sentStatsDiv) return;
    const isCalculating =
      !speed || speed === "-" || speed === "..." || !eta || eta === "-";
    this.sentStatsDiv.textContent = isCalculating
      ? "Calculating..."
      : `${speed} - ETA: ${eta}`;
  }

  resetSentProgressOnly() {
    if (this.progressBarSent) {
      this.progressBarSent.style.width = "0%";
    }
    if (this.progressPercentSent) {
      this.progressPercentSent.textContent = "0%";
    }
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
    this.sentStatsDiv = null;
    this.sentButtonsContainer = null;
    this.pauseTransferBtn = null;
    this.stopTransferBtn = null;
  }

  resetReceivedProgressOnly() {
    if (this.progressBarReceived) {
      this.progressBarReceived.style.width = "0%";
    }
    if (this.progressPercentReceived) {
      this.progressPercentReceived.textContent = "0%";
    }
  }

  ensureReceivedContainer() {
    let container = document.getElementById("received-container");
    if (!container) {
      const temp = document.createElement("div");
      temp.innerHTML = this.receivedTemplateHTML;
      container = temp.firstElementChild;
      this.fileTransferSection.appendChild(container);
    }
    this.transferStatusDivReceived = container.querySelector(
      "#transfer-status-received",
    );
    this.progressContainerReceived = container.querySelector(
      "#received-progress-container",
    );
    this.progressBarReceived =
      this.progressContainerReceived.querySelector(".progress-bar");
    this.progressPercentReceived = this.progressContainerReceived.querySelector(
      ".progress-percentage",
    );
    this.receivedStatsDiv = container.querySelector("#received-stats");

    this.progressContainerReceived.style.display = "block";
    this.progressPercentReceived.style.display = "inline-block";
  }

  updateReceivedProgressBarValue(value) {
    this.progressBarReceived.style.width = `${value}%`;
    this.progressPercentReceived.textContent = `${value}%`;
  }

  updateReceivedStats(speed, eta) {
    if (!this.receivedStatsDiv) return;
    const isCalculating =
      !speed || speed === "-" || speed === "..." || !eta || eta === "-";
    this.receivedStatsDiv.textContent = isCalculating
      ? "Calculating..."
      : `${speed} - ETA: ${eta}`;
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
    this.receivedStatsDiv = null;
  }

  handleSendChat() {
    const text = this.chatInput.value.trim();
    if (text && window.webrtcManager) {
      window.webrtcManager.sendChat(text);
      this.chatInput.value = "";
    }
  }

  toggleChat() {
    if (!this.chatSection) return;

    if (this.chatSection.style.display === "none") {
      this.chatSection.style.display = "block";
      if (this.toggleChatBtn) {
        this.toggleChatBtn.textContent = "Close Chat";
        this.toggleChatBtn.classList.remove("has-unread");
      }
      this.chatBox.scrollTop = this.chatBox.scrollHeight;
    } else {
      this.chatSection.style.display = "none";
      if (this.toggleChatBtn) this.toggleChatBtn.textContent = "Open Chat";
    }
  }

  archiveChat(peerDisplayName, peerId) {
    if (!this.chatBox || !this.chatHistoryList) return;

    const messages = this.chatBox.querySelectorAll(".chat-message");
    if (messages.length === 0) return;

    const historyBlock = document.createElement("div");
    historyBlock.style.borderBottom = "1px dashed #ccc";
    historyBlock.style.paddingBottom = "10px";
    historyBlock.style.marginBottom = "5px";
    historyBlock.style.display = "flex";
    historyBlock.style.flexDirection = "column";

    const timestamp = document.createElement("div");

    let peerLabel = "";
    if (peerDisplayName) {
      if (peerId && peerId !== peerDisplayName) {
        peerLabel = ` with ${peerDisplayName} (${peerId})`;
      } else {
        peerLabel = ` with ${peerDisplayName}`;
      }
    } else if (peerId) {
      peerLabel = ` with ${peerId}`;
    }

    timestamp.textContent = `Session ended at ${new Date().toLocaleTimeString()}${peerLabel}`;
    timestamp.style.fontSize = "0.75rem";
    timestamp.style.fontStyle = "italic";
    timestamp.style.color = "#999";
    timestamp.style.marginBottom = "8px";
    historyBlock.appendChild(timestamp);

    messages.forEach((msg) => {
      const clone = msg.cloneNode(true);
      historyBlock.appendChild(clone);
    });

    this.chatHistoryList.prepend(historyBlock);

    if (this.transferHistoryDiv)
      this.transferHistoryDiv.style.display = "block";
    if (this.chatHistorySection)
      this.chatHistorySection.style.display = "block";

    this.chatHistoryList.scrollTop = 0;

    this.ensureClearHistoryButton();

    this.chatBox.innerHTML =
      '<div class="chat-placeholder">No messages yet...</div>';
  }

  ensureClearHistoryButton() {
    let eraseHistoryBtn = document.getElementById("erase-history-btn");
    if (!eraseHistoryBtn) {
      eraseHistoryBtn = document.createElement("button");
      eraseHistoryBtn.id = "erase-history-btn";
      eraseHistoryBtn.className = "erase-history-btn";
      eraseHistoryBtn.textContent = "Clear History";
      eraseHistoryBtn.addEventListener("click", () => {
        const outContainer = document.getElementById("outgoing-files");
        const inContainer = document.getElementById("incoming-files");

        if (outContainer) {
          Array.from(outContainer.querySelectorAll("a")).forEach((link) =>
            URL.revokeObjectURL(link.href),
          );
          outContainer.innerHTML = "";
        }
        if (inContainer) {
          Array.from(inContainer.querySelectorAll("a")).forEach((link) =>
            URL.revokeObjectURL(link.href),
          );
          inContainer.innerHTML = "";
        }

        const chatHistoryList = document.getElementById("chat-history-list");
        if (chatHistoryList) chatHistoryList.innerHTML = "";
        const chatSection = document.getElementById("chat-history-section");
        if (chatSection) chatSection.style.display = "none";

        const transferHistory = document.getElementById("transfer-history");
        if (transferHistory) transferHistory.style.display = "none";

        const outSection = document.getElementById("outgoing-section");
        if (outSection) outSection.style.display = "none";
        const inSection = document.getElementById("incoming-section");
        if (inSection) inSection.style.display = "none";

        eraseHistoryBtn.remove();
      });

      const container = document.querySelector(".erase-history-container");
      if (container) container.appendChild(eraseHistoryBtn);
    }

    if (eraseHistoryBtn) eraseHistoryBtn.style.display = "inline-block";
    const transferHistory = document.getElementById("transfer-history");
    if (transferHistory) transferHistory.style.display = "block";
  }

  updateToIdle() {
    const peerName = this.activeConnectionStatus
      ? this.activeConnectionStatus.textContent
      : null;
    const peerId = this.activeConnectionStatus
      ? this.activeConnectionStatus.getAttribute("data-peer-id")
      : null;
    this.archiveChat(peerName, peerId);

    const editBtn = document.getElementById("edit-nickname-btn");
    if (editBtn) editBtn.style.display = "none";

    this.clearFileAlert();
    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;
    this.activeConnectionContainer.style.display = "none";
    this.activeConnectionStatus.textContent = "";
    this.endBtn.style.display = "none";
    this.fileTransferSection.style.display = "none";
    if (this.chatSection) this.chatSection.style.display = "none";
    if (this.toggleChatBtn) {
      this.toggleChatBtn.style.display = "none";
      this.toggleChatBtn.classList.remove("has-unread");
    }

    this.resetSentTransferUI();
    this.resetReceivedTransferUI();
  }

  updateToWaiting() {
    this.resetSentTransferUI();
    this.resetReceivedTransferUI();

    this.activeConnectionContainer.style.display = "flex";
    this.activeConnectionLabel.textContent = "Waiting for peer...";
    this.activeConnectionStatus.textContent = "";

    const editBtn = document.getElementById("edit-nickname-btn");
    if (editBtn) editBtn.style.display = "none";

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

    this.activeConnectionStatus.setAttribute("data-peer-id", peerId);
    this.updatePeerIdentityDisplay(peerId);

    this.endBtn.textContent = "Disconnect";
    this.endBtn.style.display = "inline-block";

    let editBtn = document.getElementById("edit-nickname-btn");

    if (!editBtn) {
      editBtn = document.createElement("button");
      editBtn.id = "edit-nickname-btn";
      editBtn.textContent = "✎";
      editBtn.title = "Edit Nickname";
      editBtn.style.padding = "2px 6px";
      editBtn.style.cursor = "pointer";
      editBtn.style.fontSize = "0.9rem";
      editBtn.style.background = "transparent";
      editBtn.style.border = "1px solid #4a90e2";
      editBtn.style.borderRadius = "4px";
      editBtn.style.boxShadow = "none";
      editBtn.style.color = "#4a90e2";
      editBtn.style.fontWeight = "bold";

      editBtn.addEventListener("click", () => {
        const pid = this.activeConnectionStatus.getAttribute("data-peer-id");
        const currentName = this.getNickname(pid);
        const newName = prompt(
          "Enter nickname for this peer:",
          currentName === pid ? "" : currentName,
        );
        if (newName !== null) {
          this.setNickname(pid, newName);
        }
      });
      this.activeConnectionContainer.appendChild(editBtn);
    }
    editBtn.style.display = "inline-block";

    this.updatePeerIdentityDisplay(peerId);

    this.fileTransferSection.style.display = "block";

    if (this.toggleChatBtn) {
      this.toggleChatBtn.style.display = "inline-block";
      const isChatVisible =
        this.chatSection && this.chatSection.style.display !== "none";
      this.toggleChatBtn.textContent = isChatVisible
        ? "Close Chat"
        : "Open Chat";
      this.toggleChatBtn.classList.remove("has-unread");
    }
  }

  updateToConnected(peerId) {
    clearTimeout(this.newIdAlertTimer);

    this.uploadField.value = "";
    this.fileTransferBtn.disabled = true;

    if (
      this.progressContainerSent &&
      this.progressContainerSent.style.display !== "none"
    ) {
      this.resetSentTransferUI();
    }
    if (
      this.progressContainerReceived &&
      this.progressContainerReceived.style.display !== "none"
    ) {
      this.resetReceivedTransferUI();
    }

    if (this.activeConnectionContainer.style.display !== "flex") {
      this.activeConnectionContainer.style.display = "flex";
    }

    this.activeConnectionLabel.textContent = "Connected to:";

    this.activeConnectionStatus.setAttribute("data-peer-id", peerId);
    this.activeConnectionStatus.textContent = this.getNickname(peerId);

    this.activeConnectionStatus.style.textDecoration = "underline";
    this.activeConnectionStatus.style.textDecorationColor = "#27ae60";
    this.activeConnectionStatus.style.textDecorationThickness = "3px";

    this.endBtn.textContent = "Disconnect";
    if (this.endBtn.style.display !== "inline-block") {
      this.endBtn.style.display = "inline-block";
    }

    let editBtn = document.getElementById("edit-nickname-btn");
    if (!editBtn) {
      editBtn = document.createElement("button");
      editBtn.id = "edit-nickname-btn";
      editBtn.textContent = "✎";
      editBtn.title = "Edit Nickname";
      editBtn.style.padding = "2px 6px";
      editBtn.style.cursor = "pointer";
      editBtn.style.fontSize = "0.9rem";
      editBtn.style.color = "#4a90e2";
      editBtn.style.fontWeight = "bold";
      editBtn.style.background = "transparent";
      editBtn.style.border = "1px solid #4a90e2";
      editBtn.style.borderRadius = "4px";
      editBtn.style.boxShadow = "none";

      editBtn.addEventListener("click", () => {
        const pid = this.activeConnectionStatus.getAttribute("data-peer-id");
        const currentName = this.getNickname(pid);
        const newName = prompt(
          "Enter nickname for this peer:",
          currentName === pid ? "" : currentName,
        );
        if (newName !== null) {
          this.setNickname(pid, newName);
        }
      });
      this.activeConnectionContainer.appendChild(editBtn);
    }
    if (editBtn.style.display !== "inline-block") {
      editBtn.style.display = "inline-block";
    }

    this.updatePeerIdentityDisplay(peerId);

    if (this.fileTransferSection.style.display !== "block") {
      this.fileTransferSection.style.display = "block";
    }

    if (this.toggleChatBtn) {
      if (this.toggleChatBtn.style.display !== "inline-block") {
        this.toggleChatBtn.style.display = "inline-block";
      }
      const isChatVisible =
        this.chatSection && this.chatSection.style.display !== "none";
      this.toggleChatBtn.textContent = isChatVisible
        ? "Close Chat"
        : "Open Chat";
      this.toggleChatBtn.classList.remove("has-unread");
    }

    this.newIdAlertTimer = setTimeout(() => {
      this.activeConnectionStatus.style.textDecoration = "";
      this.activeConnectionStatus.style.textDecorationColor = "";
      this.activeConnectionStatus.style.textDecorationThickness = "";
    }, ID_UNDERLINE_TIMEOUT);
  }

  appendChatMessage(text, isSelf) {
    if (!this.chatBox) return;

    if (
      !isSelf &&
      this.chatSection &&
      this.chatSection.style.display === "none"
    ) {
      if (this.toggleChatBtn) {
        this.toggleChatBtn.classList.add("has-unread");
      }
    }

    const placeholder = this.chatBox.querySelector(".chat-placeholder");
    if (placeholder) {
      placeholder.remove();
    }

    const msgDiv = document.createElement("div");
    msgDiv.classList.add("chat-message");
    msgDiv.classList.add(isSelf ? "self" : "peer");

    msgDiv.textContent = text;

    const timeSpan = document.createElement("span");
    timeSpan.style.fontSize = "0.7em";
    timeSpan.style.opacity = "0.7";
    timeSpan.style.marginLeft = "8px";
    const now = new Date();
    timeSpan.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    msgDiv.appendChild(timeSpan);

    this.chatBox.appendChild(msgDiv);
    this.chatBox.scrollTop = this.chatBox.scrollHeight;
  }
}

const uiManager = new UIManager();
window.uiManager = uiManager;