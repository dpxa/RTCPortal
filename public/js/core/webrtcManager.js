class WebRTCManager {
  constructor() {
    this.socket = environmentIsProd
      ? io("https://rtcportal.onrender.com", {
          transports: SOCKET_IO_TRANSPORTS,
        })
      : io({
          transports: SOCKET_IO_TRANSPORTS,
        });

    this.peerConnection = null;
    this.dataChannel = null;
    this.pendingPeerConnection = null;
    this.pendingDataChannel = null;
    this.activePeerId = null;
    this.selfId = null;

    this.newConnTimer = null;
    this.connectionStartTime = null;
    this.answerReceivedTime = null;
    this.signalingDuration = null;
    this.totalConnectionDuration = null;

    this.candidateQueue = [];

    this.initializeElements();
    this.initializeEventListeners();
    this.initializeSocketEvents();
  }

  initializeElements() {
    this.myIdDisplay = document.getElementById("my-id-display");
    this.copyIdBtn = document.getElementById("copy-id-btn");
    this.copyLinkBtn = document.getElementById("copy-link-btn");
    this.showQrBtn = document.getElementById("show-qr-btn");
    this.qrCodeWrapper = document.getElementById("qr-code-wrapper");
    this.qrCodeContainer = document.getElementById("qr-code-container");
    this.partnerIdField = document.getElementById("partner-id-field");
    this.connectBtn = document.getElementById("connect-btn");
    this.endBtn = document.getElementById("end-btn");
  }

  initializeEventListeners() {
    this.copyIdBtn.addEventListener("click", () => this.copyId());
    this.copyLinkBtn.addEventListener("click", () => this.copyLink());
    this.showQrBtn.addEventListener("click", () => this.toggleQrCode());
    this.partnerIdField.addEventListener("input", () =>
      this.updateConnectButton(),
    );
    this.connectBtn.addEventListener("click", () => this.initiateConnection());
    this.endBtn.addEventListener("click", () => this.handleEndConnection());

    window.addEventListener("beforeunload", () => this.cleanup());
  }

  initializeSocketEvents() {
    this.socket.on("connect", () => {
      this.selfId = this.socket.id;
      this.myIdDisplay.classList.remove("inactive");
      this.myIdDisplay.classList.add("active");
      this.myIdDisplay.textContent = this.selfId;
      this.copyIdBtn.style.display = "inline-block";
      this.copyLinkBtn.style.display = "inline-block";
      this.showQrBtn.style.display = "inline-block";

      uiManager.clearAlert();

      this.handleUrlParameters();
    });

    this.socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error.message || error);
      this.myIdDisplay.classList.add("inactive");
      this.myIdDisplay.classList.remove("active");
      this.myIdDisplay.textContent = "Connection Error";
      this.copyIdBtn.style.display = "none";
      this.copyLinkBtn.style.display = "none";
      this.showQrBtn.style.display = "none";
      uiManager.showIdError("Failed to connect to server. Retrying...");
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("Socket disconnected:", reason);
      this.myIdDisplay.classList.add("inactive");
      this.myIdDisplay.classList.remove("active");
      this.myIdDisplay.textContent = "Disconnected";
      this.copyIdBtn.style.display = "none";
      this.copyLinkBtn.style.display = "none";
      this.showQrBtn.style.display = "none";

      if (reason === "io server disconnect") {
        uiManager.showIdError("Disconnected by server. Reconnecting...");
        this.socket.connect();
      } else if (reason === "transport close" || reason === "transport error") {
        uiManager.showIdError("Connection lost. Reconnecting...");
      }

      if (this.peerConnection) {
        this.resetCurrentConnection();
      }
      if (this.pendingPeerConnection) {
        this.abortPendingConnection(false);
      }
    });

    this.socket.on("reconnect", (attemptNumber) => {
      console.log("Socket reconnected after", attemptNumber, "attempts");
      uiManager.clearAlert();
    });

    this.socket.on("reconnect_error", (error) => {
      console.error("Socket reconnection error:", error.message || error);
    });

    this.socket.on("reconnect_failed", () => {
      console.error("Socket reconnection failed");
      uiManager.showIdError(
        "Unable to reconnect to server. Please refresh the page.",
      );
    });

    this.socket.on("offer", async (data) => {
      await this.handleOffer(data);
    });

    this.socket.on("answer", async (data) => {
      await this.handleAnswer(data);
    });

    this.socket.on("candidate", (data) => {
      this.handleCandidate(data);
    });

    this.socket.on("peer-not-found", (data) => {
      this.handlePeerNotFound(data);
    });
  }

  copyId() {
    if (this.selfId) {
      navigator.clipboard
        .writeText(this.selfId)
        .then(() => uiManager.showCopied())
        .catch((error) => console.error("Error copying ID:", error));
    } else {
      uiManager.showIdError("No ID to copy yet.");
    }
  }

  copyLink() {
    if (this.selfId) {
      const url = `${window.location.origin}${window.location.pathname}?peer=${this.selfId}`;
      navigator.clipboard
        .writeText(url)
        .then(() => uiManager.showCopied())
        .catch((error) => console.error("Error copying Link:", error));
    } else {
      uiManager.showIdError("No ID to copy yet.");
    }
  }

  toggleQrCode() {
    if (this.qrCodeWrapper.style.display === "none") {
      this.qrCodeWrapper.style.display = "block";
      this.showQrBtn.textContent = "Hide QR";

      this.qrCodeContainer.innerHTML = "";
      const url = `${window.location.origin}${window.location.pathname}?peer=${this.selfId}`;
      new QRCode(this.qrCodeContainer, {
        text: url,
        width: 128,
        height: 128,
        colorDark: getCssVar("--qr-color-dark", "#000000"),
        colorLight: getCssVar("--qr-color-light", "#ffffff"),
        correctLevel: QRCode.CorrectLevel.H,
      });
    } else {
      this.qrCodeWrapper.style.display = "none";
      this.showQrBtn.textContent = "QR Code";
    }
  }

  handleUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const peerId = urlParams.get("peer");

    if (peerId && peerId !== this.selfId) {
      this.partnerIdField.value = peerId;
      this.updateConnectButton();
      this.initiateConnection();

      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  updateConnectButton() {
    this.connectBtn.disabled = this.partnerIdField.value.trim() === "";
  }

  async initiateConnection() {
    const peerId = this.partnerIdField.value.trim();
    this.partnerIdField.value = "";
    this.connectBtn.disabled = true;

    if (!/^[a-zA-Z0-9_-]+$/.test(peerId)) {
      uiManager.showIdError("Invalid peer ID!");
      return;
    }
    if (peerId === this.selfId) {
      uiManager.showIdError("Cannot connect to yourself.");
      return;
    }
    if (peerId === this.activePeerId) {
      uiManager.showIdError("Already connected.");
      return;
    }

    this.socket.emit("connection-attempt");
    this.candidateQueue = [];
    uiManager.clearAlert();
    this.abortPendingConnection();
    uiManager.updateToWaiting();

    await new Promise((resolve) => requestAnimationFrame(resolve));

    if (fileTransferManager) {
      fileTransferManager.clearFileSelection();
    }

    this.connectionStartTime = performance.now();

    this.newConnTimer = setTimeout(() => {
      uiManager.showIdError("Connection timed out.");
      this.socket.emit("connection-user-failed");
      this.abortPendingConnection(false);
      statsService.fetchConnectionStats();
    }, CONNECTION_TIMEOUT);

    this.pendingPeerConnection = new RTCPeerConnection(
      turnService.getRtcConfig(),
    );
    this.configureConnection(this.pendingPeerConnection, peerId, true);

    try {
      const offer = await this.pendingPeerConnection.createOffer();
      await this.pendingPeerConnection.setLocalDescription(offer);

      this.socket.emit("offer", {
        target: peerId,
        sdp: this.pendingPeerConnection.localDescription,
      });
    } catch (err) {
      console.error("Error creating offer:", err);
      uiManager.showIdError("Failed to create connection offer.");
      this.abortPendingConnection(false);
      this.resetConnectionTiming();
      statsService.fetchConnectionStats();
    }
  }

  async handleOffer(data) {
    if (fileTransferManager) {
      fileTransferManager.clearFileSelection();
    }

    uiManager.clearAlert();
    this.abortPendingConnection();
    if (this.peerConnection) {
      this.resetCurrentConnection();
    }

    this.connectionStartTime = performance.now();

    this.candidateQueue = [];
    this.peerConnection = new RTCPeerConnection(turnService.getRtcConfig());
    this.configureConnection(this.peerConnection, data.caller, false);

    try {
      await this.peerConnection.setRemoteDescription(data.sdp);
      this.drainCandidateQueue(this.peerConnection);
      const ans = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(ans);
      this.activePeerId = data.caller;

      this.socket.emit("answer", {
        target: data.caller,
        sdp: this.peerConnection.localDescription,
      });
    } catch (err) {
      console.error("Error handling offer:", err);
      this.resetConnectionTiming();
      this.resetCurrentConnection();
    }
  }

  async handleAnswer(data) {
    this.answerReceivedTime = performance.now();

    if (this.connectionStartTime) {
      this.signalingDuration =
        this.answerReceivedTime - this.connectionStartTime;
    }

    if (this.activePeerId) {
      this.resetCurrentConnection();
    }
    try {
      await this.pendingPeerConnection.setRemoteDescription(data.sdp);
      this.drainCandidateQueue(this.pendingPeerConnection);
      this.activePeerId = data.callee;

      this.peerConnection = this.pendingPeerConnection;
      this.dataChannel = this.pendingDataChannel;
      this.pendingPeerConnection = null;
      this.pendingDataChannel = null;
    } catch (err) {
      console.error("Error applying remote description:", err);
      uiManager.showIdError("Failed to establish connection.");
      this.abortPendingConnection(false);
      this.resetConnectionTiming();
      statsService.fetchConnectionStats();
    }
  }

  handleCandidate(data) {
    const targetConnection = this.pendingPeerConnection || this.peerConnection;
    if (targetConnection) {
      if (targetConnection.remoteDescription) {
        targetConnection
          .addIceCandidate(data.candidate)
          .catch((e) => console.error(e));
      } else {
        this.candidateQueue.push(data.candidate);
      }
    }
  }

  drainCandidateQueue(connection) {
    while (this.candidateQueue.length) {
      const c = this.candidateQueue.shift();
      connection.addIceCandidate(c).catch((e) => console.error(e));
    }
  }

  handleConnectionFailure(conn) {
    statsService.fetchConnectionStats();
    if (conn === this.pendingPeerConnection) {
      this.abortPendingConnection(false);
    } else {
      this.resetCurrentConnection();
    }
  }

  handlePeerNotFound(data) {
    if (!this.peerConnection) {
      uiManager.updateToIdle();
    }
    if (this.pendingPeerConnection) {
      this.abortPendingConnection();
    } else {
      this.resetCurrentConnection();
    }
    uiManager.showIdError("Peer ID not found!");
  }

  configureConnection(conn, targetId, isInitiator) {
    conn._successEmitted = false;

    conn.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.socket.emit("candidate", {
          target: targetId,
          candidate: evt.candidate,
        });
      }
    };

    conn.ondatachannel = (evt) => {
      const channel = evt.channel;
      this.initializeDataChannel(channel);
      if (!isInitiator) {
        this.dataChannel = channel;
      }
    };

    conn.onconnectionstatechange = () => {
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }

      if (conn.connectionState === "connected") {
        this.startHeartbeat();
        if (isInitiator && !conn._successEmitted) {
          conn._successEmitted = true;
          this.socket.emit("connection-success");
        }

        if (this.connectionStartTime) {
          this.totalConnectionDuration =
            performance.now() - this.connectionStartTime;

          if (this.answerReceivedTime) {
            this.signalingDuration =
              this.answerReceivedTime - this.connectionStartTime;
          }

          this.logConnectionStats();
          this.resetConnectionTiming();
        }

        clearTimeout(this.newConnTimer);
        uiManager.updateToConnected(targetId);

        statsService.fetchConnectionStats();
      } else if (conn.connectionState === "disconnected") {
        console.warn("Connection disconnected, attempting to recover...");
        this.disconnectTimer = setTimeout(() => {
          if (conn.connectionState !== "connected") {
            console.log("Recovery failed, closing connection.");
            this.handleConnectionFailure(conn);
          }
        }, 5000);
      } else if (conn.connectionState === "failed") {
        this.handleConnectionFailure(conn);
      }
    };

    if (isInitiator) {
      this.pendingDataChannel = conn.createDataChannel("fileChannel");
      this.initializeDataChannel(this.pendingDataChannel);
    }
  }

  initializeDataChannel(channel) {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (evt) => {
      if (typeof evt.data === "string") {
        try {
          const message = JSON.parse(evt.data);
          if (this.handleControlMessage(message)) return;
        } catch (e) {}
        fileTransferManager.processControlInstruction(evt.data);
      } else {
        fileTransferManager.processIncomingChunk(evt.data);
      }
    };
  }

  handleControlMessage(message) {
    if (message.type === "disconnect") {
      this.resetCurrentConnection();
      return true;
    }

    if (message.type === "ping") {
      try {
        this.dataChannel.send(JSON.stringify({ type: "pong" }));
      } catch (e) {}
      return true;
    }

    if (message.type === "pong") {
      return true;
    }

    if (message.type === "chat") {
      uiManager.appendChatMessage(message.text, false);
      return true;
    }

    return false;
  }

  sendChat(text) {
    if (this.dataChannel && this.dataChannel.readyState === "open") {
      const msg = { type: "chat", text: text };
      this.dataChannel.send(JSON.stringify(msg));
      uiManager.appendChatMessage(text, true);
    } else {
      console.warn("Cannot send chat: Data channel not open.");
    }
  }

  handleEndConnection() {
    if (!this.peerConnection) {
      uiManager.updateToIdle();
    }
    if (this.pendingPeerConnection) {
      this.abortPendingConnection();
    } else {
      this.resetCurrentConnection();
    }
  }

  abortPendingConnection(emitUserFail = true) {
    uiManager.clearAlert();
    clearTimeout(this.newConnTimer);

    if (fileTransferManager) {
      fileTransferManager.cleanupAllTransfers();
    }

    if (this.pendingPeerConnection && emitUserFail) {
      this.socket.emit("connection-user-failed");
    }
    if (this.pendingPeerConnection) {
      this.pendingPeerConnection.onicecandidate = null;
      this.pendingPeerConnection.ondatachannel = null;
      this.pendingPeerConnection.onconnectionstatechange = null;
      this.pendingPeerConnection.close();
      this.pendingPeerConnection = null;
    }
    if (this.pendingDataChannel) {
      this.pendingDataChannel.close();
      this.pendingDataChannel = null;
    }
    if (this.peerConnection) {
      uiManager.updateToConnectedAfterAbort(this.activePeerId);
    }
  }

  resetCurrentConnection() {
    this.stopHeartbeat();
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    uiManager.clearAlert();
    clearTimeout(this.newConnTimer);

    if (fileTransferManager) {
      fileTransferManager.cleanupAllTransfers();
      fileTransferManager.clearFileSelection();
    }

    if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(JSON.stringify({ type: "disconnect" }));
    }
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ondatachannel = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    this.activePeerId = null;
    uiManager.updateToIdle();
  }

  resetConnectionTiming() {
    this.connectionStartTime = null;
    this.answerReceivedTime = null;
    this.signalingDuration = null;
    this.totalConnectionDuration = null;
  }

  logConnectionStats() {
    if (this.signalingDuration && this.totalConnectionDuration) {
      this.signalingDuration = Math.round(this.signalingDuration * 100) / 100;
      const webRTCNegotiation =
        Math.round(
          (this.totalConnectionDuration - this.signalingDuration) * 100,
        ) / 100;
      this.totalConnectionDuration =
        Math.round(this.totalConnectionDuration * 100) / 100;

      console.log(`Connection Timing Stats (Peer: ${this.activePeerId}):
      - Signaling Duration: ${this.signalingDuration}ms
      - WebRTC Negotiation: ${webRTCNegotiation}ms
      - Total Connection Duration: ${this.totalConnectionDuration}ms`);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.dataChannel && this.dataChannel.readyState === "open") {
        try {
          this.dataChannel.send(JSON.stringify({ type: "ping" }));
        } catch (e) {
          console.warn("Heartbeat failed", e);
        }
      }
    }, 2000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  cleanup() {
    this.stopHeartbeat();
    if (this.activePeerId) {
      this.resetCurrentConnection();
    }
    if (this.pendingPeerConnection) {
      this.abortPendingConnection();
    }
  }
}

const webrtcManager = new WebRTCManager();
window.webrtcManager = webrtcManager;
