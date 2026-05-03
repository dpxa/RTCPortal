class UIManager {
  constructor() {
    this.idMsgTimer = null;
    this.newIdAlertTimer = null;
    this.fileMsgTimer = null;

    this.currentSendProgress = -1;
    this.currentReceiveProgress = -1;
    this.nicknames = {};

    this.webRtcHandlers = {};
    this.fileTransferHandlers = {};
    this.historyClearHandlers = new Set();
    this.pageExitHandlers = new Set();
    this.pageExitTriggered = false;
    this._onPaste = null;
    this._onClearHistory = null;
    this._onPageExit = null;
    this._themeMediaQuery = null;
    this._onThemePreferenceChange = null;

    this._initializeElements();
    this._attachEventListeners();
    this.initializeTemplates();
    this.initializeTheme();
    this.setConnectButtonEnabled(this.getPartnerIdValue() !== "");
  }

  _initializeElements() {
    this.myIdDisplay = document.getElementById("my-id-display");
    this.pinActionButtons = document.getElementById("pin-action-buttons");
    this.copyIdBtn = document.getElementById("copy-id-btn");
    this.copyLinkBtn = document.getElementById("copy-link-btn");
    this.showQrBtn = document.getElementById("show-qr-btn");
    this.qrCodeWrapper = document.getElementById("qr-code-wrapper");
    this.qrCodeContainer = document.getElementById("qr-code-container");
    this.partnerIdField = document.getElementById("partner-id-field");
    this.connectBtn = document.getElementById("connect-btn");

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

    this.chatSection = document.getElementById("chat-section");
    this.chatBox = document.getElementById("chat-box");
    this.chatInput = document.getElementById("chat-input");
    this.chatSendBtn = document.getElementById("send-chat-btn");
    this.toggleChatBtn = document.getElementById("toggle-chat-btn");
    this.chatHistorySection = document.getElementById("chat-history-section");
    this.chatHistoryList = document.getElementById("chat-history-list");

    this.successRateDisplay = document.getElementById("success-rate-display");
    this.uptimeDisplay = document.getElementById("uptime-display");
    this.totalDataDisplay = document.getElementById("total-data-display");
    this.totalFilesDisplay = document.getElementById("total-files-display");

    this.themeToggleBtn = document.getElementById("theme-toggle");
  }

  _attachEventListeners() {
    if (this.toggleChatBtn) {
      this.toggleChatBtn.addEventListener("click", () => this.toggleChat());
    }
    if (this.chatSendBtn) {
      this.chatSendBtn.addEventListener("click", () => this.handleSendChat());
    }
    if (this.chatInput) {
      this.chatInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          this.handleSendChat();
        }
      });
    }

    if (this.copyIdBtn) {
      this.copyIdBtn.addEventListener("click", () => {
        this._safeCall(this.webRtcHandlers.onCopyId);
      });
    }
    if (this.copyLinkBtn) {
      this.copyLinkBtn.addEventListener("click", () => {
        this._safeCall(this.webRtcHandlers.onCopyLink);
      });
    }
    if (this.showQrBtn) {
      this.showQrBtn.addEventListener("click", () => {
        this._safeCall(this.webRtcHandlers.onToggleQr);
      });
    }
    if (this.partnerIdField) {
      this.partnerIdField.addEventListener("input", () => {
        this.setConnectButtonEnabled(this.getPartnerIdValue() !== "");
        this._safeCall(
          this.webRtcHandlers.onPartnerIdInput,
          this.getPartnerIdValue(),
        );
      });
    }
    if (this.connectBtn) {
      this.connectBtn.addEventListener("click", () => {
        this._safeCall(this.webRtcHandlers.onConnect);
      });
    }
    if (this.endBtn) {
      this.endBtn.addEventListener("click", () => {
        this._safeCall(this.webRtcHandlers.onDisconnect);
      });
    }

    if (this.browseFilesBtn && this.uploadField) {
      this.browseFilesBtn.addEventListener("click", () => {
        this.uploadField.click();
      });
    }

    if (this.browseFolderBtn && this.folderUploadField) {
      this.browseFolderBtn.addEventListener("click", () => {
        this._safeCall(this._handleFolderBrowseClick.bind(this));
      });
    }

    if (this.uploadField) {
      this.uploadField.addEventListener("change", () => {
        this._safeCall(
          this.fileTransferHandlers.onFilesSelected,
          this.uploadField.files,
          null,
        );
      });
    }

    if (this.folderUploadField) {
      this.folderUploadField.addEventListener("change", () => {
        let rootFolderName = null;
        if (this.folderUploadField.files.length > 0) {
          const firstPath = this.folderUploadField.files[0].webkitRelativePath;
          if (firstPath && firstPath.includes("/")) {
            rootFolderName = firstPath.split("/")[0];
          }
        }

        this._safeCall(
          this.fileTransferHandlers.onFilesSelected,
          this.folderUploadField.files,
          rootFolderName,
        );
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

      this.dropZone.addEventListener("drop", (event) => {
        this._safeCall(this.fileTransferHandlers.onDrop, event);
      });
    }

    if (this.fileTransferBtn) {
      this.fileTransferBtn.addEventListener("click", () => {
        this._safeCall(this.fileTransferHandlers.onSendTransfer);
      });
    }

    this._onPaste = (event) => {
      this._safeCall(this.fileTransferHandlers.onPaste, event);
    };
    document.addEventListener("paste", this._onPaste);

    this._onClearHistory = () => {
      this._clearChatHistoryUI();
      for (const handler of this.historyClearHandlers) {
        this._safeCall(handler);
      }
      this.setClearHistoryVisible(false);
    };
    document.addEventListener("clear-history", this._onClearHistory);

    this._onPageExit = () => {
      if (this.pageExitTriggered) {
        return;
      }

      this.pageExitTriggered = true;
      this.dispose();
      clearTimeout(this.idMsgTimer);
      clearTimeout(this.newIdAlertTimer);
      clearTimeout(this.fileMsgTimer);

      for (const handler of this.pageExitHandlers) {
        this._safeCall(handler);
      }
    };

    window.addEventListener("beforeunload", this._onPageExit);
    window.addEventListener("pagehide", this._onPageExit);
  }

  dispose() {
    if (this._onPaste) {
      document.removeEventListener("paste", this._onPaste);
      this._onPaste = null;
    }

    if (this._onClearHistory) {
      document.removeEventListener("clear-history", this._onClearHistory);
      this._onClearHistory = null;
    }

    if (this._onPageExit) {
      window.removeEventListener("beforeunload", this._onPageExit);
      window.removeEventListener("pagehide", this._onPageExit);
      this._onPageExit = null;
    }

    if (this._themeMediaQuery && this._onThemePreferenceChange) {
      this._themeMediaQuery.removeEventListener(
        "change",
        this._onThemePreferenceChange,
      );
      this._onThemePreferenceChange = null;
      this._themeMediaQuery = null;
    }
  }

  async _handleFolderBrowseClick() {
    if (!this.folderUploadField) return;

    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker();
        this._safeCall(
          this.fileTransferHandlers.onDirectoryHandleSelected,
          dirHandle,
        );
      } catch (error) {
        if (error && error.name !== "AbortError") {
          this.folderUploadField.click();
        }
      }
      return;
    }

    this.folderUploadField.click();
  }

  _safeCall(handler, ...args) {
    if (typeof handler !== "function") return;

    try {
      const result = handler(...args);
      if (result && typeof result.then === "function") {
        result.catch((error) => {
          console.error("UI callback failed:", error);
        });
      }
    } catch (error) {
      console.error("UI callback failed:", error);
    }
  }

  _setHidden(element, shouldHide) {
    if (element) {
      element.hidden = Boolean(shouldHide);
    }
  }

  _isVisible(element) {
    return !!element && !element.hidden;
  }

  bindWebRTCHandlers(handlers) {
    this.webRtcHandlers = {
      ...this.webRtcHandlers,
      ...handlers,
    };
  }

  bindFileTransferHandlers(handlers) {
    this.fileTransferHandlers = {
      ...this.fileTransferHandlers,
      ...handlers,
    };
  }

  registerHistoryClearHandler(handler) {
    if (typeof handler === "function") {
      this.historyClearHandlers.add(handler);
    }
  }

  registerPageExitHandler(handler) {
    if (typeof handler === "function") {
      this.pageExitHandlers.add(handler);
    }
  }

  initializeTheme() {
    if (!this.themeToggleBtn) return;

    this.createThemeIcon();

    const applyTheme = (isDark, savePreference = false) => {
      document.body.classList.toggle("dark-mode", isDark);
      this.updateThemeIcon(isDark);

      if (!savePreference) return;

      try {
        localStorage.setItem("rtcTheme", isDark ? "dark" : "light");
      } catch (error) {
        console.warn("Unable to save theme preference:", error);
      }
    };

    this._applyInitialTheme(applyTheme);

    this.themeToggleBtn.addEventListener("click", () => {
      const isDark = !document.body.classList.contains("dark-mode");
      applyTheme(isDark, true);
    });
  }

  _applyInitialTheme(applyTheme) {
    let persistedTheme = null;
    try {
      persistedTheme = localStorage.getItem("rtcTheme");
    } catch (error) {
      console.warn("localStorage restricted:", error);
    }

    if (persistedTheme === "dark") {
      applyTheme(true);
    } else if (persistedTheme === "light") {
      applyTheme(false);
    }

    try {
      this._themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      if (!persistedTheme && this._themeMediaQuery.matches) {
        applyTheme(true);
      }

      if (this._themeMediaQuery.addEventListener) {
        this._onThemePreferenceChange = (event) => {
          let currentPreference = null;
          try {
            currentPreference = localStorage.getItem("rtcTheme");
          } catch (error) {
            console.warn("Unable to read stored theme preference:", error);
          }

          if (!currentPreference) {
            applyTheme(event.matches);
          }
        };

        this._themeMediaQuery.addEventListener(
          "change",
          this._onThemePreferenceChange,
        );
      }
    } catch (error) {
      console.warn("Theme media matching failed:", error);
    }
  }

  createThemeIcon() {
    if (!this.themeToggleBtn) return;

    this.themeToggleBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path class="moon-icon" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        <g class="sun-icon icon-hidden">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </g>
      </svg>
    `;
  }

  updateThemeIcon(isDark) {
    if (!this.themeToggleBtn) return;

    const moonIcon = this.themeToggleBtn.querySelector(".moon-icon");
    const sunIcon = this.themeToggleBtn.querySelector(".sun-icon");

    if (!moonIcon || !sunIcon) return;

    moonIcon.classList.toggle("icon-hidden", isDark);
    sunIcon.classList.toggle("icon-hidden", !isDark);
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
      this.activeConnectionStatus?.getAttribute("data-peer-id");
    if (currentPeerId === peerId) {
      this.updatePeerIdentityDisplay(peerId);
    }
  }

  updatePeerIdentityDisplay(peerId) {
    if (!this.activeConnectionStatus || !this.activeConnectionContainer) return;

    const nickname = this.getNickname(peerId);
    this.activeConnectionStatus.textContent = nickname;

    let idSpan = document.getElementById("peer-id-display-span");

    if (nickname !== peerId) {
      if (!idSpan) {
        idSpan = document.createElement("span");
        idSpan.id = "peer-id-display-span";
        idSpan.className = "peer-id-display";
      }

      idSpan.textContent = `(${peerId})`;

      const editBtn = document.getElementById("edit-nickname-btn");
      if (editBtn && editBtn.parentNode === this.activeConnectionContainer) {
        this.activeConnectionContainer.insertBefore(idSpan, editBtn);
      } else {
        this.activeConnectionContainer.appendChild(idSpan);
      }
    } else if (idSpan) {
      idSpan.remove();
    }
  }

  ensureEditNicknameButton() {
    if (!this.activeConnectionContainer) return null;

    let editBtn = document.getElementById("edit-nickname-btn");
    if (!editBtn) {
      editBtn = document.createElement("button");
      editBtn.id = "edit-nickname-btn";
      editBtn.className = "edit-nickname-btn";
      editBtn.textContent = "Edit";
      editBtn.title = "Edit Nickname";
      editBtn.addEventListener("click", () => {
        const peerId =
          this.activeConnectionStatus?.getAttribute("data-peer-id");
        if (!peerId) return;

        const currentName = this.getNickname(peerId);
        const newName = prompt(
          "Enter nickname for this peer:",
          currentName === peerId ? "" : currentName,
        );

        if (newName !== null) {
          this.setNickname(peerId, newName);
        }
      });
      this.activeConnectionContainer.appendChild(editBtn);
    }

    return editBtn;
  }

  initializeTemplates() {
    this.sentTemplateHTML = `
      <div id="sent-container">
        <div class="progress-container" id="sent-progress-container" hidden>
          <div class="progress-bar"></div>
          <span class="progress-percentage" hidden>0%</span>
        </div>
        <div id="sent-stats" hidden></div>
        <div id="sent-buttons-container" hidden>
          <button id="pause-transfer-btn">Pause</button>
          <button id="stop-transfer-btn">Stop</button>
        </div>
        <div id="transfer-status-sent" class="transfer-status-text"></div>
      </div>
    `;

    this.receivedTemplateHTML = `
      <div id="received-container">
        <div class="progress-container" id="received-progress-container" hidden>
          <div class="progress-bar"></div>
          <span class="progress-percentage" hidden>0%</span>
        </div>
        <div id="received-stats" hidden></div>
        <div id="transfer-status-received" class="transfer-status-text"></div>
      </div>
    `;
  }

  setAlertMessage(targetElement, { text, isError = false, isSuccess = false }) {
    if (!targetElement) return;

    targetElement.classList.remove("error", "success", "visible");

    if (!text) {
      targetElement.textContent = "";
      return;
    }

    targetElement.textContent = text;
    targetElement.classList.add("visible");
    if (isError) targetElement.classList.add("error");
    if (isSuccess) targetElement.classList.add("success");
  }

  showCopied() {
    clearTimeout(this.idMsgTimer);
    this.setAlertMessage(this.statusIdMessage, {
      text: "Copied",
      isSuccess: true,
    });
    this.idMsgTimer = setTimeout(() => this.clearAlert(), ALERT_TIMEOUT);
  }

  showIdError(message) {
    clearTimeout(this.idMsgTimer);
    this.setAlertMessage(this.statusIdMessage, {
      text: message,
      isError: true,
    });
    this.idMsgTimer = setTimeout(() => this.clearAlert(), ALERT_TIMEOUT);
  }

  clearAlert() {
    clearTimeout(this.idMsgTimer);
    this.clearMessage(this.statusIdMessage);
  }

  showFileAlert(message) {
    clearTimeout(this.fileMsgTimer);
    this.clearFileInputs();
    this.setFileTransferButtonEnabled(false);
    this.setAlertMessage(this.fileStatusMessage, {
      text: message,
      isError: true,
    });
    this.fileMsgTimer = setTimeout(() => this.clearFileAlert(), ALERT_TIMEOUT);
  }

  showFileWarning(message) {
    clearTimeout(this.fileMsgTimer);
    this.setAlertMessage(this.fileStatusMessage, {
      text: message,
      isError: true,
    });
    this.fileMsgTimer = setTimeout(
      () => this.clearFileAlert(),
      WARNING_TIMEOUT,
    );
  }

  clearFileAlert() {
    clearTimeout(this.fileMsgTimer);
    this.clearMessage(this.fileStatusMessage);
  }

  clearMessage(targetElement) {
    if (!targetElement) return;
    targetElement.textContent = "";
    targetElement.classList.remove("error", "success", "visible");
  }

  setConnectButtonEnabled(isEnabled) {
    if (this.connectBtn) {
      this.connectBtn.disabled = !isEnabled;
    }
  }

  getPartnerIdValue() {
    if (!this.partnerIdField) return "";
    return this.partnerIdField.value.trim();
  }

  setPartnerIdValue(value) {
    if (!this.partnerIdField) return;
    this.partnerIdField.value = value || "";
    this.setConnectButtonEnabled(this.getPartnerIdValue() !== "");
  }

  consumePartnerIdValue() {
    const value = this.getPartnerIdValue();
    this.setPartnerIdValue("");
    return value;
  }

  isQrVisible() {
    return this._isVisible(this.qrCodeWrapper);
  }

  showQrCodeForId(selfId) {
    if (typeof QRCode === "undefined") {
      this.showIdError("QR Code library failed to load");
      return false;
    }

    if (
      !selfId ||
      !this.qrCodeContainer ||
      !this.qrCodeWrapper ||
      !this.showQrBtn
    ) {
      return false;
    }

    const url = `${window.location.origin}${window.location.pathname}?peer=${selfId}`;

    this._setHidden(this.qrCodeWrapper, false);
    this.showQrBtn.textContent = "Hide QR";
    this.qrCodeContainer.innerHTML = "";

    new QRCode(this.qrCodeContainer, {
      text: url,
      width: 128,
      height: 128,
      colorDark: getCssVar("--qr-color-dark", "#000000"),
      colorLight: getCssVar("--qr-color-light", "#ffffff"),
      correctLevel: QRCode.CorrectLevel.H,
    });

    return true;
  }

  hideQrCode() {
    this._setHidden(this.qrCodeWrapper, true);
    if (this.showQrBtn) {
      this.showQrBtn.textContent = "QR Code";
    }
  }

  toggleQrCodeForId(selfId) {
    if (this.isQrVisible()) {
      this.hideQrCode();
      return false;
    }

    return this.showQrCodeForId(selfId);
  }

  setLocalPinAssigned(pin) {
    if (!this.myIdDisplay) return;

    this.myIdDisplay.classList.remove("inactive");
    this.myIdDisplay.classList.add("active");
    this.myIdDisplay.textContent = pin;
    this._setHidden(this.pinActionButtons, false);
  }

  setLocalPinStatus(text) {
    if (!this.myIdDisplay) return;

    this.myIdDisplay.classList.remove("active");
    this.myIdDisplay.classList.add("inactive");
    this.myIdDisplay.textContent = text;
    this._setHidden(this.pinActionButtons, true);
    this.hideQrCode();
  }

  setFileSelectionSummary(text) {
    if (this.fileNameDisplay) {
      this.fileNameDisplay.textContent = text || "";
    }
  }

  clearFileInputs() {
    if (this.uploadField) this.uploadField.value = "";
    if (this.folderUploadField) this.folderUploadField.value = "";
  }

  setFileTransferButtonEnabled(isEnabled) {
    if (this.fileTransferBtn) {
      this.fileTransferBtn.disabled = !isEnabled;
    }
  }

  setSentButtonsVisible(isVisible) {
    if (this.sentButtonsContainer) {
      this._setHidden(this.sentButtonsContainer, !isVisible);
    }
  }

  setPauseButtonLabel(label) {
    if (this.pauseTransferBtn) {
      this.pauseTransferBtn.textContent = label;
    }
  }

  setSentStatus(text) {
    if (this.transferStatusDivSent) {
      this.transferStatusDivSent.textContent = text || "";
    }
  }

  setReceivedStatus(text) {
    if (this.transferStatusDivReceived) {
      this.transferStatusDivReceived.textContent = text || "";
    }
  }

  ensureSentContainer() {
    if (!this.fileTransferSection) return;

    let container = document.getElementById("sent-container");
    const isNew = !container;

    if (isNew) {
      const templateWrapper = document.createElement("div");
      templateWrapper.innerHTML = this.sentTemplateHTML;
      container = templateWrapper.firstElementChild;
      this.fileTransferSection.appendChild(container);

      this.transferStatusDivSent = container.querySelector(
        "#transfer-status-sent",
      );
      this.progressContainerSent = container.querySelector(
        "#sent-progress-container",
      );
      this.progressBarSent =
        this.progressContainerSent?.querySelector(".progress-bar");
      this.progressPercentSent = this.progressContainerSent?.querySelector(
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
          this._safeCall(this.fileTransferHandlers.onTogglePause);
        });
      }

      if (this.stopTransferBtn) {
        this.stopTransferBtn.addEventListener("click", () => {
          this._safeCall(this.fileTransferHandlers.onStopTransfer);
        });
      }
    }

    this._setHidden(this.progressContainerSent, false);
    this._setHidden(this.sentButtonsContainer, false);
    this._setHidden(this.progressPercentSent, false);
  }

  _updateDocumentTitle() {
    const titleFragments = [];

    const sendProgress = Math.round(this.currentSendProgress);
    const receiveProgress = Math.round(this.currentReceiveProgress);

    if (sendProgress >= 0 && sendProgress <= 100) {
      titleFragments.push(`${sendProgress}% S`);
    }

    if (receiveProgress >= 0 && receiveProgress <= 100) {
      titleFragments.push(`${receiveProgress}% R`);
    }

    if (titleFragments.length > 0) {
      document.title = `(${titleFragments.join(", ")}) RTCPortal - P2P Transfer Hub`;
      return;
    }

    document.title = "RTCPortal - P2P Transfer Hub";
  }

  _normalizeProgressValue(value) {
    const numericValue = Number(value);
    if (!isFinite(numericValue)) return 0;
    return Math.max(0, Math.min(100, numericValue));
  }

  _updateProgressBar(barElement, percentElement, value) {
    const normalizedValue = this._normalizeProgressValue(value);
    const progressPercent = Math.round(normalizedValue);
    if (barElement) {
      barElement.style.width = `${progressPercent}%`;
    }
    if (percentElement) {
      percentElement.textContent = `${progressPercent}%`;
    }
  }

  updateSentProgressBarValue(value) {
    this.currentSendProgress = this._normalizeProgressValue(value);
    this._updateProgressBar(
      this.progressBarSent,
      this.progressPercentSent,
      this.currentSendProgress,
    );
    this._updateDocumentTitle();
  }

  _updateStatsBlock(statsDiv, buttonsContainer, speed, eta) {
    if (!statsDiv) return;

    if (speed === "" && eta === "") {
      statsDiv.hidden = true;
      statsDiv.textContent = "";
      if (buttonsContainer) {
        buttonsContainer.hidden = true;
      }
      return;
    }

    statsDiv.hidden = false;

    let statsRow = statsDiv.querySelector(".transfer-stats-row");
    let speedSpan = statsDiv.querySelector(".transfer-stat-speed");
    let etaSpan = statsDiv.querySelector(".transfer-stat-eta");

    if (!statsRow || !speedSpan || !etaSpan) {
      statsDiv.textContent = "";

      statsRow = document.createElement("div");
      statsRow.className = "transfer-stats-row";

      speedSpan = document.createElement("span");
      speedSpan.className = "transfer-stat transfer-stat-speed";

      etaSpan = document.createElement("span");
      etaSpan.className = "transfer-stat transfer-stat-eta";

      statsRow.appendChild(speedSpan);
      statsRow.appendChild(etaSpan);
      statsDiv.appendChild(statsRow);
    }

    const hasSpeed = Boolean(speed && speed !== "-" && speed !== "...");
    const hasEta = Boolean(eta && eta !== "-" && eta !== "...");

    speedSpan.textContent = hasSpeed
      ? `Speed: ${speed}`
      : "Speed: Calculating...";
    etaSpan.textContent = hasEta ? `ETA: ${eta}` : "ETA: Calculating...";
  }

  updateSentStats(speed, eta) {
    this._updateStatsBlock(
      this.sentStatsDiv,
      this.sentButtonsContainer,
      speed,
      eta,
    );
  }

  resetSentProgressOnly() {
    this.currentSendProgress = -1;
    this._updateProgressBar(this.progressBarSent, this.progressPercentSent, 0);
    this._updateDocumentTitle();
  }

  _removeContainerAndReset(type) {
    const container = document.getElementById(`${type}-container`);
    if (container) {
      container.remove();
    }
  }

  resetSentTransferUI() {
    this._removeContainerAndReset("sent");
    this.currentSendProgress = -1;
    this._updateDocumentTitle();

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
    this.currentReceiveProgress = -1;
    this._updateProgressBar(
      this.progressBarReceived,
      this.progressPercentReceived,
      0,
    );
    this._updateDocumentTitle();
  }

  ensureReceivedContainer() {
    if (!this.fileTransferSection) return;

    let container = document.getElementById("received-container");
    if (!container) {
      const templateWrapper = document.createElement("div");
      templateWrapper.innerHTML = this.receivedTemplateHTML;
      container = templateWrapper.firstElementChild;
      this.fileTransferSection.appendChild(container);

      this.transferStatusDivReceived = container.querySelector(
        "#transfer-status-received",
      );
      this.progressContainerReceived = container.querySelector(
        "#received-progress-container",
      );
      this.progressBarReceived =
        this.progressContainerReceived?.querySelector(".progress-bar");
      this.progressPercentReceived =
        this.progressContainerReceived?.querySelector(".progress-percentage");
      this.receivedStatsDiv = container.querySelector("#received-stats");
    }

    this._setHidden(this.progressContainerReceived, false);
    this._setHidden(this.progressPercentReceived, false);
  }

  updateReceivedProgressBarValue(value) {
    this.currentReceiveProgress = this._normalizeProgressValue(value);
    this._updateProgressBar(
      this.progressBarReceived,
      this.progressPercentReceived,
      this.currentReceiveProgress,
    );
    this._updateDocumentTitle();
  }

  updateReceivedStats(speed, eta) {
    this._updateStatsBlock(this.receivedStatsDiv, null, speed, eta);
  }

  resetReceivedTransferUI() {
    this._removeContainerAndReset("received");
    this.currentReceiveProgress = -1;
    this._updateDocumentTitle();

    this.transferStatusDivReceived = null;
    this.progressContainerReceived = null;
    this.progressBarReceived = null;
    this.progressPercentReceived = null;
    this.receivedStatsDiv = null;
  }

  handleSendChat() {
    const text = this.chatInput?.value.trim();
    if (!text) return;

    this._safeCall(this.webRtcHandlers.onSendChat, text);
    this.chatInput.value = "";
  }

  toggleChat() {
    if (!this.chatSection) return;

    const showChat = !this._isVisible(this.chatSection);
    this._setHidden(this.chatSection, !showChat);

    if (this.toggleChatBtn) {
      this.toggleChatBtn.textContent = showChat ? "Close Chat" : "Open Chat";
      if (showChat) {
        this.toggleChatBtn.classList.remove("has-unread");
      }
    }

    if (showChat && this.chatBox) {
      this.chatBox.scrollTop = this.chatBox.scrollHeight;
    }
  }

  archiveChat(peerDisplayName, peerId) {
    if (!this.chatBox || !this.chatHistoryList) return;

    const messages = this.chatBox.querySelectorAll(".chat-message");
    if (messages.length === 0) return;

    const historyBlock = document.createElement("div");
    historyBlock.className = "history-session-block";

    const timestamp = document.createElement("div");
    timestamp.className = "history-session-timestamp";

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
    historyBlock.appendChild(timestamp);

    messages.forEach((message) => {
      const clone = message.cloneNode(true);
      historyBlock.appendChild(clone);
    });

    this.chatHistoryList.prepend(historyBlock);

    this._setHidden(this.transferHistoryDiv, false);
    this._setHidden(this.chatHistorySection, false);
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
        document.dispatchEvent(new Event("clear-history"));
      });

      if (this.eraseHistoryContainer) {
        this.eraseHistoryContainer.appendChild(eraseHistoryBtn);
      }
    }

    this.setClearHistoryVisible(true);
    this._setHidden(this.transferHistoryDiv, false);
  }

  setClearHistoryVisible(isVisible) {
    const eraseHistoryBtn = document.getElementById("erase-history-btn");
    if (!eraseHistoryBtn) return;

    eraseHistoryBtn.hidden = !isVisible;
  }

  _clearChatHistoryUI() {
    if (this.chatHistoryList) {
      this.chatHistoryList.innerHTML = "";
    }

    this._setHidden(this.chatHistorySection, true);
  }

  clearTransferHistoryUI() {
    if (this.outgoingFilesContainer) this.outgoingFilesContainer.innerHTML = "";
    if (this.incomingFilesContainer) this.incomingFilesContainer.innerHTML = "";
    if (this.outgoingFoldersContainer)
      this.outgoingFoldersContainer.innerHTML = "";
    if (this.incomingFoldersContainer)
      this.incomingFoldersContainer.innerHTML = "";

    this._setHidden(this.transferHistoryDiv, true);
    this._setHidden(this.outgoingFilesSection, true);
    this._setHidden(this.incomingFilesSection, true);
    this._setHidden(this.outgoingFoldersSection, true);
    this._setHidden(this.incomingFoldersSection, true);
  }

  updateToIdle() {
    const peerName = this.activeConnectionStatus?.textContent || null;
    const peerId =
      this.activeConnectionStatus?.getAttribute("data-peer-id") || null;
    this.archiveChat(peerName, peerId);

    const editBtn = document.getElementById("edit-nickname-btn");
    if (editBtn) {
      editBtn.hidden = true;
    }

    this.clearFileAlert();
    this.clearFileInputs();
    this.setFileTransferButtonEnabled(false);

    this._setHidden(this.activeConnectionContainer, true);
    if (this.activeConnectionStatus) {
      this.activeConnectionStatus.textContent = "";
      this.activeConnectionStatus.removeAttribute("data-peer-id");
      this.activeConnectionStatus.classList.remove(
        "connection-status-emphasis",
      );
    }

    this._setHidden(this.endBtn, true);
    this._setHidden(this.fileTransferSection, true);
    this._setHidden(this.chatSection, true);

    if (this.toggleChatBtn) {
      this._setHidden(this.toggleChatBtn, true);
      this.toggleChatBtn.classList.remove("has-unread");
      this.toggleChatBtn.textContent = "Open Chat";
    }

    this.resetSentTransferUI();
    this.resetReceivedTransferUI();
  }

  updateToWaiting() {
    this.resetSentTransferUI();
    this.resetReceivedTransferUI();

    this._setHidden(this.activeConnectionContainer, false);
    if (this.activeConnectionLabel) {
      this.activeConnectionLabel.textContent = "Waiting for peer...";
    }
    if (this.activeConnectionStatus) {
      this.activeConnectionStatus.textContent = "";
      this.activeConnectionStatus.removeAttribute("data-peer-id");
      this.activeConnectionStatus.classList.remove(
        "connection-status-emphasis",
      );
    }

    const editBtn = document.getElementById("edit-nickname-btn");
    if (editBtn) {
      editBtn.hidden = true;
    }

    if (this.endBtn) {
      this.endBtn.textContent = "Cancel";
      this._setHidden(this.endBtn, false);
    }
  }

  updateToConnectedAfterAbort(peerId) {
    this.resetSentTransferUI();
    this.resetReceivedTransferUI();

    this._setHidden(this.activeConnectionContainer, false);
    if (this.activeConnectionLabel) {
      this.activeConnectionLabel.textContent = "Connected to:";
    }

    if (this.activeConnectionStatus) {
      this.activeConnectionStatus.setAttribute("data-peer-id", peerId);
      this.activeConnectionStatus.classList.remove(
        "connection-status-emphasis",
      );
    }

    this.updatePeerIdentityDisplay(peerId);

    if (this.endBtn) {
      this.endBtn.textContent = "Disconnect";
      this._setHidden(this.endBtn, false);
    }

    const editBtn = this.ensureEditNicknameButton();
    if (editBtn) {
      editBtn.hidden = false;
    }

    this._setHidden(this.fileTransferSection, false);

    if (this.toggleChatBtn) {
      this._setHidden(this.toggleChatBtn, false);
      this.toggleChatBtn.classList.remove("has-unread");
      this.toggleChatBtn.textContent = this._isVisible(this.chatSection)
        ? "Close Chat"
        : "Open Chat";
    }
  }

  updateToConnected(peerId) {
    clearTimeout(this.newIdAlertTimer);

    this.clearFileInputs();
    this.setFileTransferButtonEnabled(false);

    if (
      this.progressContainerSent &&
      this._isVisible(this.progressContainerSent)
    ) {
      this.resetSentTransferUI();
    }
    if (
      this.progressContainerReceived &&
      this._isVisible(this.progressContainerReceived)
    ) {
      this.resetReceivedTransferUI();
    }

    this._setHidden(this.activeConnectionContainer, false);

    if (this.activeConnectionLabel) {
      this.activeConnectionLabel.textContent = "Connected to:";
    }

    if (this.activeConnectionStatus) {
      this.activeConnectionStatus.setAttribute("data-peer-id", peerId);
      this.activeConnectionStatus.classList.add("connection-status-emphasis");
    }

    this.updatePeerIdentityDisplay(peerId);

    if (this.endBtn) {
      this.endBtn.textContent = "Disconnect";
      this._setHidden(this.endBtn, false);
    }

    const editBtn = this.ensureEditNicknameButton();
    if (editBtn) {
      editBtn.hidden = false;
    }

    this._setHidden(this.fileTransferSection, false);

    if (this.toggleChatBtn) {
      this._setHidden(this.toggleChatBtn, false);
      this.toggleChatBtn.classList.remove("has-unread");
      this.toggleChatBtn.textContent = this._isVisible(this.chatSection)
        ? "Close Chat"
        : "Open Chat";
    }

    this.newIdAlertTimer = setTimeout(() => {
      this.activeConnectionStatus?.classList.remove(
        "connection-status-emphasis",
      );
    }, ID_UNDERLINE_TIMEOUT);
  }

  appendChatMessage(text, isSelf) {
    if (!this.chatBox) return;

    if (!isSelf && this.chatSection && !this._isVisible(this.chatSection)) {
      if (this.toggleChatBtn) {
        this.toggleChatBtn.classList.add("has-unread");
      }
    }

    const placeholder = this.chatBox.querySelector(".chat-placeholder");
    if (placeholder) {
      placeholder.remove();
    }

    const messageDiv = document.createElement("div");
    messageDiv.classList.add("chat-message", isSelf ? "self" : "peer");
    messageDiv.textContent = text;

    const timeSpan = document.createElement("span");
    timeSpan.className = "chat-message-time";
    timeSpan.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    messageDiv.appendChild(timeSpan);

    this.chatBox.appendChild(messageDiv);
    this.chatBox.scrollTop = this.chatBox.scrollHeight;
  }

  renderTransferHistoryBatch(payload) {
    const {
      batch,
      direction,
      rootDirectoryName,
      statusSuffix,
      peerDisplay,
      onZipDownload,
      singleFileDownload,
    } = payload;

    if (!Array.isArray(batch) || batch.length === 0) return;

    const isFolderItem =
      Boolean(rootDirectoryName) ||
      batch.some(
        (file) => file.isDirectoryMarker || String(file.name).includes("/"),
      );

    let targetContainer, targetSection;

    if (direction === "from") {
      targetContainer = isFolderItem
        ? this.incomingFoldersContainer
        : this.incomingFilesContainer;
      targetSection = isFolderItem
        ? this.incomingFoldersSection
        : this.incomingFilesSection;
    } else {
      targetContainer = isFolderItem
        ? this.outgoingFoldersContainer
        : this.outgoingFilesContainer;
      targetSection = isFolderItem
        ? this.outgoingFoldersSection
        : this.outgoingFilesSection;
    }

    if (!targetContainer || !targetSection) return;

    const normalizedStatusSuffix =
      typeof statusSuffix === "string" ? statusSuffix.trim() : "";
    const isIncompleteStatus =
      normalizedStatusSuffix.toLowerCase() === "incomplete";

    let displayName = "Files";
    if (rootDirectoryName) {
      displayName = rootDirectoryName;
    } else if (isFolderItem) {
      displayName = String(batch[0].name || "").split("/")[0] || "Folder";
    } else if (batch.length === 1) {
      displayName = String(batch[0].name || "File");
    } else {
      const hasPriorReceivedZipGroup =
        direction === "from" &&
        !isFolderItem &&
        Boolean(targetContainer.firstElementChild);

      displayName = hasPriorReceivedZipGroup
        ? `Last ${batch.length} Files`
        : `${batch.length} Files`;
    }

    const totalSize = batch.reduce(
      (total, file) => total + (Number(file.size) || 0),
      0,
    );
    const isSingleFile = batch.length === 1 && !isFolderItem;

    const wrapperDiv = document.createElement("div");
    wrapperDiv.className = "history-entry-wrapper";

    if (
      direction === "from" &&
      !isSingleFile &&
      typeof onZipDownload === "function"
    ) {
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "batch-zip-container";

      const downloadButton = document.createElement("button");
      downloadButton.className = "zip-download-btn";

      const setDownloadButtonLabel = () => {
        const baseLabel = `Download ${String(displayName || "").trim()}`;

        downloadButton.textContent = baseLabel;

        if (isIncompleteStatus) {
          const suffixSpan = document.createElement("span");
          suffixSpan.className = "history-status-incomplete";
          suffixSpan.textContent = " - Incomplete";
          downloadButton.appendChild(suffixSpan);
        }
      };

      setDownloadButtonLabel();

      downloadButton.addEventListener("click", async () => {
        downloadButton.textContent = "Zipping...";
        downloadButton.disabled = true;

        try {
          await onZipDownload(downloadButton, displayName);
        } finally {
          setDownloadButtonLabel();
          downloadButton.disabled = false;
        }
      });

      buttonContainer.appendChild(downloadButton);
      wrapperDiv.appendChild(buttonContainer);
    }

    const entryDiv = document.createElement("div");
    entryDiv.className = "history-entry-row";

    const shouldRenderAnchor =
      direction === "from" && isSingleFile && singleFileDownload?.url;

    const label = document.createElement(shouldRenderAnchor ? "a" : "span");
    label.className = "history-entry-label";

    if (shouldRenderAnchor) {
      label.href = singleFileDownload.url;
      label.download = singleFileDownload.fileName;
    }

    label.textContent = displayName;
    if (normalizedStatusSuffix) {
      const suffixSpan = document.createElement("span");
      suffixSpan.textContent = isIncompleteStatus
        ? " - Incomplete"
        : ` - ${normalizedStatusSuffix}`;
      if (isIncompleteStatus) {
        suffixSpan.classList.add("history-status-incomplete");
      }
      label.appendChild(suffixSpan);
    }
    entryDiv.appendChild(label);

    const metaSpan = document.createElement("span");
    metaSpan.className = "history-entry-meta";
    metaSpan.textContent = `(${appUtils.formatBytes(totalSize)}) ${
      direction === "from" ? "Received from" : "Sent to"
    }: ${peerDisplay}, at ${new Date().toLocaleTimeString()}`;
    entryDiv.appendChild(metaSpan);

    wrapperDiv.appendChild(entryDiv);

    this._setHidden(targetSection, false);

    if (targetContainer.firstChild) {
      targetContainer.insertBefore(wrapperDiv, targetContainer.firstChild);
    } else {
      targetContainer.appendChild(wrapperDiv);
    }

    this._setHidden(this.transferHistoryDiv, false);
    this.ensureClearHistoryButton();
  }

  isTextInputFocused() {
    if (!document.activeElement) return false;
    const tag = document.activeElement.tagName;
    return tag === "INPUT" || tag === "TEXTAREA";
  }

  _clearSuccessRateClasses() {
    if (!this.successRateDisplay) return;
    this.successRateDisplay.classList.remove(
      "stats-good",
      "stats-warn",
      "stats-bad",
    );
  }

  updateConnectionStats(stats) {
    if (!stats) return;

    const successRate = Number.isFinite(Number(stats.successRate))
      ? Math.max(0, Math.min(100, Number(stats.successRate)))
      : 0;
    const uptimeMs = Math.max(0, Number(stats.uptimeMs) || 0);
    const totalBytesTransferred = Math.max(
      0,
      Math.round(Number(stats.totalBytesTransferred) || 0),
    );
    const totalFilesTransferred = Math.max(
      0,
      Math.floor(Number(stats.totalFilesTransferred) || 0),
    );

    if (this.successRateDisplay) {
      this.successRateDisplay.textContent =
        successRate === 0 ? "0%" : `${successRate.toFixed(1)}%`;
      this._clearSuccessRateClasses();

      if (successRate >= 80) {
        this.successRateDisplay.classList.add("stats-good");
      } else if (successRate >= 60) {
        this.successRateDisplay.classList.add("stats-warn");
      } else {
        this.successRateDisplay.classList.add("stats-bad");
      }
    }

    if (this.uptimeDisplay) {
      this.uptimeDisplay.textContent = appUtils.formatUptime(uptimeMs);
    }

    if (this.totalDataDisplay) {
      this.totalDataDisplay.textContent = appUtils.formatBytes(
        totalBytesTransferred,
      );
    }

    if (this.totalFilesDisplay) {
      this.totalFilesDisplay.textContent =
        totalFilesTransferred.toLocaleString();
    }
  }

  showConnectionStatsError() {
    if (this.successRateDisplay) {
      this.successRateDisplay.textContent = "Error";
      this._clearSuccessRateClasses();
    }

    if (this.uptimeDisplay) this.uptimeDisplay.textContent = "Error";
    if (this.totalDataDisplay) this.totalDataDisplay.textContent = "Error";
    if (this.totalFilesDisplay) this.totalFilesDisplay.textContent = "Error";
  }

  triggerDownload(url, fileName) {
    if (!url || !fileName) return;

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
  }

  preventDefaults(event) {
    event.preventDefault();
    event.stopPropagation();
  }
}

const uiManager = new UIManager();
window.uiManager = uiManager;
