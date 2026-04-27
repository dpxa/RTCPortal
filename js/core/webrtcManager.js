class WebRTCManager {
  constructor() {
    this.socket = environmentIsProd
      ? io(PROD_API_URL, {
          transports: SOCKET_TRANSPORTS,
        })
      : io({
          transports: SOCKET_TRANSPORTS,
        });

    this.peerConnection = null;
    this.dataChannel = null;
    this.pendingPeerConnection = null;
    this.pendingDataChannel = null;
    this.activePeerId = null;
    this.selfId = null;

    this.newConnTimer = null;
    this.connectionAttemptId = 0;

    this.heartbeatInterval = null;
    this.disconnectTimer = null;

    this.bindUIHandlers();
    this.initializeSocketEvents();
  }

  bindUIHandlers() {
    uiManager.bindWebRTCHandlers({
      onCopyId: () => this.copyId(),
      onCopyLink: () => this.copyLink(),
      onToggleQr: () => this.toggleQrCode(),
      onPartnerIdInput: () => this.updateConnectButton(),
      onConnect: () => this.initiateConnection(),
      onSendChat: (text) => this.sendChat(text),
      onDisconnect: () => this.handleEndConnection(),
    });

    uiManager.registerPageExitHandler(() =>
      this.cleanup({ disposeSocket: true }),
    );
  }

  _disposeChannel(channel) {
    if (!channel) return;

    try {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      if (typeof channel.close === "function") {
        channel.close();
      }
    } catch (error) {
      console.warn("Failed to dispose data channel:", error);
    }
  }

  _disposePeerConnection(connection) {
    if (!connection) return;

    try {
      connection.onicecandidate = null;
      connection.ondatachannel = null;
      connection.onconnectionstatechange = null;
      connection.oniceconnectionstatechange = null;
      connection.onsignalingstatechange = null;
      connection.close();
    } catch (error) {
      console.warn("Failed to dispose peer connection:", error);
    }
  }

  initializeSocketEvents() {
    this.socket.on("connect", () => {
      uiManager.clearAlert();
      statsService.requestConnectionStats({ force: true });
    });

    this.socket.on("pin-assigned", (data) => {
      this.selfId = data.pin;
      uiManager.setLocalPinAssigned(this.selfId);

      const urlParams = new URLSearchParams(window.location.search);
      const peerId = urlParams.get("peer");

      if (peerId && peerId !== this.selfId) {
        uiManager.setPartnerIdValue(peerId);
        this.updateConnectButton();
        this.initiateConnection();

        window.history.replaceState({}, "", window.location.pathname);
      }
    });

    this.socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error.message || error);
      uiManager.setLocalPinStatus("Connection Error");
      uiManager.showIdError("Failed to connect to server. Retrying...");
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("Socket disconnected:", reason);
      uiManager.setLocalPinStatus("Disconnected");

      if (reason === "io server disconnect") {
        uiManager.showIdError("Disconnected by server. Reconnecting...");
        this.socket.connect();
      } else if (reason === "transport close" || reason === "transport error") {
        uiManager.showIdError("Connection lost. Reconnecting...");
      }

      if (this.peerConnection && this.dataChannel?.readyState === "open") {
        return;
      }

      if (this.pendingPeerConnection) {
        this.abortPendingConnection(false);
      }
    });

    this.socket.on("reconnect", () => {
      uiManager.clearAlert();
      statsService.requestConnectionStats({ force: true });
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

    this._registerSocketHandler("offer", "handleOffer");
    this._registerSocketHandler("answer", "handleAnswer");

    this.socket.on("peer-disconnected", (data) => {
      if (
        this.activePeerId === data.from ||
        (this.pendingPeerConnection && !this.activePeerId)
      ) {
        this.resetCurrentConnection({ notifyPeer: false });
        uiManager.showIdError("Peer disconnected.");
      }
    });

    this.socket.on("candidate", (data) => {
      const targetConnection =
        this.pendingPeerConnection || this.peerConnection;
      if (!targetConnection || !data?.candidate) {
        return;
      }

      if (["closed", "failed"].includes(targetConnection.connectionState)) {
        return;
      }

      if (!this._isCandidateForConnection(targetConnection, data)) {
        return;
      }

      if (targetConnection.remoteDescription?.type) {
        targetConnection.addIceCandidate(data.candidate).catch((error) => {
          console.error("Failed to add ICE candidate:", error);
        });
      } else {
        if (!Array.isArray(targetConnection._candidateQueue)) {
          targetConnection._candidateQueue = [];
        }
        targetConnection._candidateQueue.push(data.candidate);
      }
    });

    this.socket.on("peer-not-found", () => {
      if (this.pendingPeerConnection) {
        this.abortPendingConnection(false);
      } else if (this.peerConnection) {
        this.resetCurrentConnection();
      } else {
        uiManager.updateToIdle();
      }
      uiManager.showIdError("Peer ID not found!");
    });
  }

  _registerSocketHandler(eventName, handlerMethod) {
    this.socket.on(eventName, async (data) => {
      try {
        await this[handlerMethod](data);
      } catch (error) {
        console.error(`${eventName} handling failed:`, error);
      }
    });
  }

  _isCandidateForConnection(connection, payload) {
    if (!connection || !payload) {
      return false;
    }

    const sourcePeer = payload.from || payload.caller || payload.callee || null;
    if (!sourcePeer) {
      return false;
    }

    return connection._peerId === sourcePeer;
  }

  _copyToClipboard(text, errorContext) {
    if (!this.selfId) {
      uiManager.showIdError("No ID to copy yet.");
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => uiManager.showCopied())
      .catch((error) => console.error(`Error copying ${errorContext}:`, error));
  }

  copyId() {
    this._copyToClipboard(this.selfId, "ID");
  }

  copyLink() {
    const url = `${window.location.origin}${window.location.pathname}?peer=${this.selfId}`;
    this._copyToClipboard(url, "Link");
  }

  toggleQrCode() {
    if (!this.selfId) {
      uiManager.showIdError("No ID to share yet.");
      return;
    }

    const shown = uiManager.toggleQrCodeForId(this.selfId);
    if (!shown && typeof QRCode === "undefined") {
      console.warn("QRCode library is missing (blocked by network).");
    }
  }

  updateConnectButton() {
    uiManager.setConnectButtonEnabled(uiManager.getPartnerIdValue() !== "");
  }

  async initiateConnection() {
    const peerId = uiManager.consumePartnerIdValue();
    uiManager.setConnectButtonEnabled(false);

    if (!/^[a-zA-Z0-9_-]+$/.test(peerId)) {
      uiManager.showIdError("Invalid peer PIN/ID!");
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
    uiManager.clearAlert();
    this.abortPendingConnection();
    uiManager.updateToWaiting();

    const attemptId = ++this.connectionAttemptId;

    await new Promise((resolve) => requestAnimationFrame(resolve));

    if (fileTransferManager) {
      fileTransferManager.clearFileSelection();
    }

    this.newConnTimer = setTimeout(() => {
      if (attemptId !== this.connectionAttemptId) return;
      uiManager.showIdError("Connection timed out.");
      this.abortPendingConnection(false);
      statsService.requestConnectionStats();
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
      if (attemptId !== this.connectionAttemptId) {
        return;
      }
      console.error("Error creating offer:", err);
      uiManager.showIdError("Failed to create connection offer.");
      this.abortPendingConnection(false);
      this.resetConnectionTiming();
      statsService.requestConnectionStats();
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

    const attemptId = ++this.connectionAttemptId;

    this.connectionStartTime = performance.now();

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
      if (attemptId !== this.connectionAttemptId) {
        return;
      }
      console.error("Error handling offer:", err);
      this.resetConnectionTiming();
      this.resetCurrentConnection();
    }
  }

  async handleAnswer(data) {
    const currentAttemptId = this.connectionAttemptId;
    this.answerReceivedTime = performance.now();

    if (this.connectionStartTime) {
      this.signalingDuration =
        this.answerReceivedTime - this.connectionStartTime;
    }

    if (this.activePeerId) {
      this.resetCurrentConnection();
    }

    if (!this.pendingPeerConnection) {
      return;
    }

    try {
      await this.pendingPeerConnection.setRemoteDescription(data.sdp);
      this.drainCandidateQueue(this.pendingPeerConnection);

      if (currentAttemptId !== this.connectionAttemptId) {
        return;
      }

      this.activePeerId = data.callee;

      this.peerConnection = this.pendingPeerConnection;
      this.dataChannel = this.pendingDataChannel;
      this.controlChannel = this.pendingControlChannel;
      this.pendingPeerConnection = null;
      this.pendingDataChannel = null;
      this.pendingControlChannel = null;
    } catch (err) {
      if (currentAttemptId !== this.connectionAttemptId) {
        return;
      }
      console.error("Error applying remote description:", err);
      uiManager.showIdError("Failed to establish connection.");
      this.abortPendingConnection(false);
      this.resetConnectionTiming();
      statsService.requestConnectionStats();
    }
  }

  drainCandidateQueue(connection) {
    if (!Array.isArray(connection?._candidateQueue)) {
      connection._candidateQueue = [];
    }

    while (connection._candidateQueue.length) {
      const candidate = connection._candidateQueue.shift();
      connection.addIceCandidate(candidate).catch((error) => {
        console.error("Failed to drain ICE candidate queue:", error);
      });
    }
  }

  handleConnectionFailure(conn) {
    statsService.requestConnectionStats();
    if (conn === this.pendingPeerConnection) {
      this.abortPendingConnection(false);
    } else {
      this.resetCurrentConnection();
    }
  }

  configureConnection(conn, targetId, isInitiator) {
    conn._successEmitted = false;
    conn._peerId = targetId;
    conn._candidateQueue = [];

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
      if (channel.label === "controlChannel") {
        this.initializeControlChannel(channel);
        if (!isInitiator) {
          this.controlChannel = channel;
        }
      } else {
        this.initializeDataChannel(channel);
        if (!isInitiator) {
          this.dataChannel = channel;
        }
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

          this.resetConnectionTiming();
        }

        clearTimeout(this.newConnTimer);
        uiManager.updateToConnected(targetId);

        statsService.requestConnectionStats();
      } else if (conn.connectionState === "disconnected") {
        console.warn("Connection disconnected, attempting to recover...");
        this.disconnectTimer = setTimeout(() => {
          if (conn.connectionState !== "connected") {
            this.handleConnectionFailure(conn);
          }
        }, CONNECTION_RECOVERY_DELAY);
      } else if (conn.connectionState === "failed") {
        this.handleConnectionFailure(conn);
      }
    };

    if (isInitiator) {
      this.pendingControlChannel = conn.createDataChannel("controlChannel", {
        ordered: true,
      });
      this.initializeControlChannel(this.pendingControlChannel);

      this.pendingDataChannel = conn.createDataChannel("fileChannel", {
        ordered: true,
      });
      this.pendingDataChannel.bufferedAmountLowThreshold =
        DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD;
      this.initializeDataChannel(this.pendingDataChannel);
    }
  }

  initializeControlChannel(channel) {
    channel.onmessage = (evt) => {
      this.processIncomingChannelMessage(evt.data);
    };
  }

  initializeDataChannel(channel) {
    channel.bufferedAmountLowThreshold =
      DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD;
    channel.binaryType = "arraybuffer";
    channel.onmessage = (evt) => {
      this.processIncomingChannelMessage(evt.data);
    };
  }

  processIncomingChannelMessage(rawMessage) {
    if (typeof rawMessage !== "string") {
      if (fileTransferManager) {
        fileTransferManager.handleIncomingData(rawMessage);
      }
      return;
    }

    const message = appUtils.safeJsonParse(rawMessage);
    if (message && this.handleControlMessage(message)) {
      return;
    }

    if (fileTransferManager) {
      fileTransferManager.handleIncomingData(rawMessage);
    }
  }

  sendControlMessage(msgObj) {
    const payload = JSON.stringify(msgObj);
    if (this.controlChannel && this.controlChannel.readyState === "open") {
      this.controlChannel.send(payload);
    } else if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(payload);
    }
  }

  handleControlMessage(message) {
    switch (message.type) {
      case "disconnect":
        this.resetCurrentConnection({ notifyPeer: false });
        return true;
      case "ping":
        try {
          this.sendControlMessage({ type: "pong" });
        } catch (error) {
          console.error("Failed to send pong response:", error);
        }
        return true;
      case "pong":
        return true;
      case "chat": {
        if (typeof message.text !== "string") {
          return true;
        }

        const sanitizedText = message.text.trim();
        if (!sanitizedText || sanitizedText.length > 2000) {
          return true;
        }

        uiManager.appendChatMessage(sanitizedText, false);
        return true;
      }
      default:
        return false;
    }
  }

  sendChat(text) {
    if (typeof text !== "string") {
      return;
    }

    const sanitizedText = text.trim();
    if (!sanitizedText || sanitizedText.length > 2000) {
      return;
    }

    if (
      (this.controlChannel && this.controlChannel.readyState === "open") ||
      (this.dataChannel && this.dataChannel.readyState === "open")
    ) {
      this.sendControlMessage({ type: "chat", text: sanitizedText });
      uiManager.appendChatMessage(sanitizedText, true);
    } else {
      console.warn("Cannot send chat: Data channel not open.");
    }
  }

  handleEndConnection() {
    if (this.pendingPeerConnection) {
      this.abortPendingConnection();
    } else if (this.peerConnection) {
      this.resetCurrentConnection();
    } else {
      uiManager.updateToIdle();
    }
  }

  abortPendingConnection(emitUserFail = true) {
    const hadPendingAttempt = Boolean(
      this.pendingPeerConnection ||
      this.pendingDataChannel ||
      this.pendingControlChannel ||
      this.newConnTimer,
    );

    uiManager.clearAlert();
    clearTimeout(this.newConnTimer);
    this.newConnTimer = null;
    if (hadPendingAttempt) {
      this.connectionAttemptId++;
    }

    if (fileTransferManager) {
      fileTransferManager.cleanupAllTransfers();
    }

    if (this.pendingPeerConnection && emitUserFail) {
      this.socket.emit("connection-user-failed");
    }

    this._disposePeerConnection(this.pendingPeerConnection);
    this.pendingPeerConnection = null;

    this._disposeChannel(this.pendingDataChannel);
    this.pendingDataChannel = null;

    this._disposeChannel(this.pendingControlChannel);
    this.pendingControlChannel = null;

    if (this.peerConnection) {
      uiManager.updateToConnectedAfterAbort(this.activePeerId);
    } else {
      uiManager.updateToIdle();
    }
  }

  resetCurrentConnection(options = {}) {
    const { notifyPeer = true } = options;

    this.stopHeartbeat();
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    uiManager.clearAlert();
    clearTimeout(this.newConnTimer);
    this.newConnTimer = null;

    if (fileTransferManager) {
      fileTransferManager.cleanupAllTransfers();
      fileTransferManager.clearFileSelection();
    }

    if (
      notifyPeer &&
      this.dataChannel &&
      this.dataChannel.readyState === "open"
    ) {
      this.sendControlMessage({ type: "disconnect" });
    }
    this._disposePeerConnection(this.peerConnection);
    this.peerConnection = null;

    this._disposeChannel(this.dataChannel);
    this.dataChannel = null;

    this._disposeChannel(this.controlChannel);
    this.controlChannel = null;

    if (this.activePeerId) {
      if (notifyPeer) {
        this.socket.emit("peer-disconnected", { target: this.activePeerId });
      }
      this.activePeerId = null;
    }
    uiManager.updateToIdle();
  }

  resetConnectionTiming() {
    this.connectionStartTime = null;
    this.answerReceivedTime = null;
    this.signalingDuration = null;
    this.totalConnectionDuration = null;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      try {
        this.sendControlMessage({ type: "ping" });
      } catch (heartbeatError) {
        console.warn("Heartbeat failed", heartbeatError);
      }
    }, 2000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  cleanup(options = {}) {
    const { disposeSocket = false } = options;

    this.stopHeartbeat();

    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (this.newConnTimer) {
      clearTimeout(this.newConnTimer);
      this.newConnTimer = null;
    }

    if (this.peerConnection || this.activePeerId) {
      this.resetCurrentConnection({ notifyPeer: !disposeSocket });
    }
    if (
      this.pendingPeerConnection ||
      this.pendingDataChannel ||
      this.pendingControlChannel
    ) {
      this.abortPendingConnection(!disposeSocket);
    }

    if (disposeSocket && this.socket) {
      try {
        this.socket.off();
      } catch (error) {
        console.error("Socket off() failed during cleanup:", error);
      }

      try {
        this.socket.disconnect();
      } catch (error) {
        console.error("Socket disconnect() failed during cleanup:", error);
      }
    }
  }
}

const webrtcManager = new WebRTCManager();
window.webrtcManager = webrtcManager;
