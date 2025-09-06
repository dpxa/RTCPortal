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

    this.initializeSocketEvents();
    this.initializeDOMEvents();
  }

  initializeSocketEvents() {
    this.socket.on("connect", () => {
      this.selfId = this.socket.id;
      const myIdDisplay = document.getElementById("my-id-display");
      myIdDisplay.classList.remove("inactive");
      myIdDisplay.classList.add("active");
      myIdDisplay.textContent = this.selfId;
      document.getElementById("copy-id-btn").style.display = "inline-block";
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

  initializeDOMEvents() {
    const copyIdBtn = document.getElementById("copy-id-btn");
    const partnerIdField = document.getElementById("partner-id-field");
    const connectBtn = document.getElementById("connect-btn");
    const endBtn = document.getElementById("end-btn");

    copyIdBtn.addEventListener("click", () => this.copyId());
    partnerIdField.addEventListener("input", () => this.updateConnectButton());
    connectBtn.addEventListener("click", () => this.initiateConnection());
    endBtn.addEventListener("click", () => this.handleEndConnection());

    window.addEventListener("beforeunload", () => this.cleanup());
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

  updateConnectButton() {
    const partnerIdField = document.getElementById("partner-id-field");
    const connectBtn = document.getElementById("connect-btn");
    connectBtn.disabled = partnerIdField.value.trim() === "";
  }

  async initiateConnection() {
    const partnerIdField = document.getElementById("partner-id-field");
    const connectBtn = document.getElementById("connect-btn");

    const peerId = partnerIdField.value.trim();
    partnerIdField.value = "";
    connectBtn.disabled = true;

    // basic handling
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
    uiManager.clearAlert();
    this.abortPendingConnection();
    uiManager.updateToWaiting();

    this.connectionStartTime = performance.now();

    this.newConnTimer = setTimeout(() => {
      uiManager.showIdError("Connection timed out.");
      this.abortPendingConnection();
    }, CONNECTION_TIMEOUT);

    this.pendingPeerConnection = new RTCPeerConnection(
      turnService.getRtcConfig()
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
      this.resetConnectionTiming();
    }
  }

  async handleOffer(data) {
    uiManager.clearAlert();
    this.abortPendingConnection();
    if (this.peerConnection) {
      this.resetCurrentConnection(false);
    }

    this.connectionStartTime = performance.now();

    this.peerConnection = new RTCPeerConnection(turnService.getRtcConfig());
    this.configureConnection(this.peerConnection, data.caller, false);

    try {
      await this.peerConnection.setRemoteDescription(data.sdp);
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
      this.activePeerId = data.callee;

      this.peerConnection = this.pendingPeerConnection;
      this.dataChannel = this.pendingDataChannel;
      this.pendingPeerConnection = null;
      this.pendingDataChannel = null;
    } catch (err) {
      console.error("Error applying remote description:", err);
      this.resetConnectionTiming();
    }
  }

  handleCandidate(data) {
    const targetConnection = this.pendingPeerConnection || this.peerConnection;
    if (targetConnection) {
      targetConnection
        .addIceCandidate(data.candidate)
        .catch((e) => console.error(e));
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
      if (conn.connectionState === "connected") {
        if (isInitiator) {
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
        uiManager.updateToConnected(this.activePeerId);

        if (statsService) {
          statsService.fetchConnectionStats();
        }
      } else if (["disconnected", "failed"].includes(conn.connectionState)) {
        this.resetCurrentConnection();
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
          if (message.type === "disconnect") {
            this.resetCurrentConnection();
            return;
          }
        } catch (e) {}
        fileTransferManager.processControlInstruction(evt.data);
      } else {
        fileTransferManager.processIncomingChunk(evt.data);
      }
    };
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

  abortPendingConnection() {
    uiManager.clearAlert();
    clearTimeout(this.newConnTimer);

    if (this.pendingPeerConnection) {
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

  resetCurrentConnection(resetUI = true) {
    uiManager.clearAlert();
    clearTimeout(this.newConnTimer);
    if (fileTransferManager) {
      clearTimeout(fileTransferManager.fileMsgTimer);
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
    if (resetUI) {
      uiManager.updateToIdle();
    } else {
      const uploadField = document.getElementById("upload-field");
      const fileTransferBtn = document.getElementById("file-transfer-btn");
      uploadField.value = "";
      fileTransferBtn.disabled = true;
    }
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
          (this.totalConnectionDuration - this.signalingDuration) * 100
        ) / 100;
      this.totalConnectionDuration =
        Math.round(this.totalConnectionDuration * 100) / 100;

      console.log(`Connection Timing Stats (Peer: ${this.activePeerId}):
      - Signaling Duration: ${this.signalingDuration}ms
      - WebRTC Negotiation: ${webRTCNegotiation}ms
      - Total Connection Duration: ${this.totalConnectionDuration}ms`);
    }
  }

  cleanup() {
    if (this.activePeerId) {
      this.resetCurrentConnection();
    }
    if (this.pendingPeerConnection) {
      this.abortPendingConnection();
    }
  }
}

const webrtcManager = new WebRTCManager();
