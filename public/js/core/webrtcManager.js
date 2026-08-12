import {
  BASE_API_URL,
  DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD,
  CONNECTION_TIMEOUT,
  CONNECTION_RECOVERY_DELAY,
  HEARTBEAT_INTERVAL,
  SOCKET_TRANSPORTS,
} from "../config/constants.js";
import { appUtils } from "../utils/commonUtils.js";
import {
  deriveSessionKey,
  generateKeyPair,
  exportPublicKey,
  decryptTaggedPayload,
  encryptMessage,
  ENCRYPTION_TAGS,
} from "../utils/encryption.js";
import { uiManager } from "../ui/uiManager.js";
import { statsService } from "../services/statsService.js";
import { turnService } from "../services/turnService.js";
import { fileTransferManager } from "./fileTransferManager.js";

class WebRTCManager {
  constructor() {
    this.socket = io(BASE_API_URL, {
      transports: SOCKET_TRANSPORTS,
    });

    this.peerConnection = null;
    this.dataChannel = null;
    this.pendingPeerConnection = null;
    this.pendingDataChannel = null;
    this.activePeerId = null;
    this.selfId = null;
    this.pendingServerDisconnect = null;

    this.newConnTimer = null;
    this.connectionAttemptId = 0;

    this.heartbeatInterval = null;
    this.disconnectTimer = null;
    this._pendingSuccessEmit = false;
    this._lastPongAt = null;

    this.encryption = {
      enabled: true,
      sessionKey: null,
      localKeyPair: null,
      remotePublicRaw: null,
      handshakeStarted: false,
      handshakeResolvers: [],
    };
    this._pendingEncryptedChunks = [];

    this._pendingCandidates = new Map();

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

  _clearTimer(timerName) {
    if (this[timerName]) {
      clearTimeout(this[timerName]);
      this[timerName] = null;
    }
  }

  _clearNewConnectionTimer() {
    this._clearTimer("newConnTimer");
  }

  _clearDisconnectTimer() {
    this._clearTimer("disconnectTimer");
  }

  _resetEncryptionState() {
    this.encryption = {
      enabled: true,
      sessionKey: null,
      localKeyPair: null,
      remotePublicRaw: null,
      handshakeStarted: false,
      handshakeResolvers: [],
    };
    this._pendingEncryptedChunks = [];
  }

  _isHandshakeMessage(message) {
    return (
      message &&
      typeof message.type === "string" &&
      (message.type === "e2e-hello" || message.type === "e2e-key")
    );
  }

  async _beginEncryptionHandshake(_peerId) {
    if (
      this.encryption.sessionKey ||
      this.encryption.handshakeStarted ||
      !this.encryption.enabled
    ) {
      return;
    }

    this.encryption.handshakeStarted = true;
    try {
      const keyPair = await generateKeyPair();
      this.encryption.localKeyPair = keyPair;
      const publicRaw = await exportPublicKey(keyPair.publicKey);

      this.sendControlMessage({
        type: "e2e-hello",
        publicKey: Array.from(new Uint8Array(publicRaw)),
      });
    } catch (error) {
      console.warn("Failed to start encryption handshake:", error);
      this.encryption.handshakeStarted = false;
      this.encryption.enabled = false;
    }
  }

  async _handleE2EHello(_peerId, message) {
    if (
      this.encryption.sessionKey ||
      !this.encryption.enabled ||
      !Array.isArray(message.publicKey) ||
      message.publicKey.length === 0
    ) {
      return;
    }

    try {
      this.encryption.remotePublicRaw = new Uint8Array(
        message.publicKey,
      ).buffer;

      if (!this.encryption.localKeyPair) {
        this.encryption.localKeyPair = await generateKeyPair();
      }

      const sessionKey = await deriveSessionKey(
        this.encryption.localKeyPair.privateKey,
        this.encryption.remotePublicRaw,
      );
      this.encryption.sessionKey = sessionKey;

      const publicRaw = await exportPublicKey(
        this.encryption.localKeyPair.publicKey,
      );
      this.sendControlMessage({
        type: "e2e-key",
        publicKey: Array.from(new Uint8Array(publicRaw)),
      });

      this._flushPendingEncryptedChunks();
      this._resolveHandshake();
    } catch (error) {
      console.warn("Encryption handshake (hello) failed:", error);
      this.encryption.enabled = false;
      this._resolveHandshake();
    }
  }

  async _handleE2EKey(_peerId, message) {
    if (
      this.encryption.sessionKey ||
      !this.encryption.enabled ||
      !Array.isArray(message.publicKey) ||
      message.publicKey.length === 0
    ) {
      return;
    }

    try {
      this.encryption.remotePublicRaw = new Uint8Array(
        message.publicKey,
      ).buffer;

      if (!this.encryption.localKeyPair) {
        this.encryption.localKeyPair = await generateKeyPair();
      }

      const sessionKey = await deriveSessionKey(
        this.encryption.localKeyPair.privateKey,
        this.encryption.remotePublicRaw,
      );
      this.encryption.sessionKey = sessionKey;

      this._flushPendingEncryptedChunks();
      this._resolveHandshake();
    } catch (error) {
      console.warn("Encryption handshake (key) failed:", error);
      this.encryption.enabled = false;
      this._resolveHandshake();
    }
  }

  _resolveHandshake() {
    const resolvers = this.encryption.handshakeResolvers;
    this.encryption.handshakeResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  _flushPendingEncryptedChunks() {
    const pending = this._pendingEncryptedChunks;
    this._pendingEncryptedChunks = [];
    for (const { payload, tag } of pending) {
      this._sendEncryptedPayload(payload, tag);
    }
  }

  _sendEncryptedPayload(payload, tag) {
    const channel =
      this.controlChannel && this.controlChannel.readyState === "open"
        ? this.controlChannel
        : this.dataChannel && this.dataChannel.readyState === "open"
          ? this.dataChannel
          : null;
    if (!channel) {
      return;
    }
    const wrapper = JSON.stringify({
      type: "e2e-chunk",
      tag,
      payload: Array.from(new Uint8Array(payload)),
    });
    try {
      channel.send(wrapper);
    } catch (error) {
      console.warn("Failed to send encrypted payload:", error);
    }
  }

  async _processEncryptedWrapper(wrapper) {
    if (
      !wrapper ||
      wrapper.type !== "e2e-chunk" ||
      !Array.isArray(wrapper.payload)
    ) {
      return;
    }
    const payload = new Uint8Array(wrapper.payload).buffer;
    if (!this.encryption.sessionKey) {
      this._pendingEncryptedChunks.push({
        payload,
        tag: wrapper.tag,
      });
      return;
    }
    try {
      const { tag, plaintext } = await decryptTaggedPayload(
        this.encryption.sessionKey,
        payload,
      );
      if (tag === ENCRYPTION_TAGS.CONTROL) {
        const text = new TextDecoder().decode(plaintext);
        const json = appUtils.safeJsonParse(text);
        if (json && this.handleControlMessage(json)) {
          return;
        }
        if (json) {
          fileTransferManager?.handleIncomingData(JSON.stringify(json));
        }
      } else {
        fileTransferManager?.handleIncomingData(plaintext);
      }
    } catch (error) {
      console.warn("Failed to decrypt e2e chunk:", error);
    }
  }

  _cleanupFileTransfer({ clearSelection = false } = {}) {
    if (!fileTransferManager) {
      return;
    }

    fileTransferManager.cleanupAllTransfers();
    if (clearSelection) {
      fileTransferManager.clearFileSelection();
    }
  }

  _handleSocketReady() {
    uiManager.clearAlert();
    statsService.requestConnectionStats({ force: true });
  }

  _isStaleAttempt(attemptId) {
    return attemptId !== this.connectionAttemptId;
  }

  _handlePendingConnectionError({ attemptId, error, logMessage, userMessage }) {
    if (this._isStaleAttempt(attemptId)) {
      return;
    }

    console.error(logMessage, error);
    if (userMessage) {
      uiManager.showIdError(userMessage);
    }
    this.abortPendingConnection(true);
    this.resetConnectionTiming();
    statsService.requestConnectionStats();
  }

  _resolveConnectionTeardown({ emitUserFailForPending = true } = {}) {
    if (this.pendingPeerConnection) {
      this.abortPendingConnection(emitUserFailForPending);
    } else if (this.peerConnection) {
      this.resetCurrentConnection();
    } else {
      uiManager.updateToIdle();
    }
  }

  _attachChannelMessageHandler(channel) {
    channel.onmessage = (evt) => {
      this.processIncomingChannelMessage(evt.data);
    };
  }

  initializeSocketEvents() {
    this.socket.on("connect", () => this._handleSocketReady());

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
        const isReconnecting =
          reason === "io server disconnect" ||
          reason === "transport close" ||
          reason === "transport error";
        this.abortPendingConnection(!isReconnecting);
      }
    });

    this.socket.on("reconnect", () => this._handleSocketReady());

    this.socket.on("reconnect_error", (error) => {
      console.error("Socket reconnection error:", error.message || error);
    });

    this.socket.on("reconnect_failed", () => {
      console.error("Socket reconnection failed");
      uiManager.showIdError(
        "Unable to reconnect to server. Please refresh the page",
      );
    });

    this._registerSocketHandler("offer", "handleOffer");
    this._registerSocketHandler("answer", "handleAnswer");

    this.socket.on("peer-replaced", (data) => {
      if (!this.activePeerId && !this.pendingPeerConnection) return;

      if (
        typeof fileTransferManager !== "undefined" &&
        (fileTransferManager.isSending || fileTransferManager.isReceiving)
      ) {
        this.pendingServerDisconnect = data;
        uiManager.setLocalPinStatus("Peer will disconnect after transfer");
        return;
      }

      this.resetCurrentConnection({ notifyPeer: false });
      uiManager.showIdError(
        "The peer disconnected: they connected to another peer",
      );
    });

    this.socket.on("peer-disconnected", (data) => {
      const relevant =
        this.activePeerId === data.from ||
        (this.pendingPeerConnection && !this.activePeerId);

      if (!relevant) return;

      if (
        typeof fileTransferManager !== "undefined" &&
        (fileTransferManager.isSending || fileTransferManager.isReceiving)
      ) {
        this.pendingServerDisconnect = data;
        uiManager.setLocalPinStatus("Peer will disconnect after transfer");
        return;
      }

      this.resetCurrentConnection({ notifyPeer: false });
      uiManager.showIdError("Peer disconnected");
    });

    this.handleLocalTransferCompleteForPendingDisconnect = () => {
      if (!this.pendingServerDisconnect) return;
      this.resetCurrentConnection({ notifyPeer: false });
      uiManager.showIdError("Peer disconnected");
      this.pendingServerDisconnect = null;
    };

    this.socket.on("candidate", async (data) => {
      const targetConnection = this._getCandidateConnection(data);
      const sourcePeer = data?.from || data?.caller || data?.callee || null;

      if (data?.candidate !== undefined) {
        if (targetConnection) {
          if (
            ["closed", "failed"].includes(targetConnection.connectionState) ||
            targetConnection.signalingState === "closed"
          ) {
            return;
          }
          if (!this._isCandidateForConnection(targetConnection, data)) {
            return;
          }

          const addCandidate = async (candidate) => {
            try {
              await targetConnection.addIceCandidate(candidate || null);
            } catch (error) {
              console.error("Failed to add ICE candidate:", error);
            }
          };

          if (targetConnection.remoteDescription?.type) {
            await addCandidate(data.candidate);
          } else {
            if (!Array.isArray(targetConnection._candidateQueue)) {
              targetConnection._candidateQueue = [];
            }
            targetConnection._candidateQueue.push(data.candidate);
          }
        } else if (sourcePeer) {
          if (!this._pendingCandidates.has(sourcePeer)) {
            this._pendingCandidates.set(sourcePeer, []);
          }
          this._pendingCandidates.get(sourcePeer).push(data.candidate);
        }
      }
    });

    this.socket.on("peer-not-found", () => {
      this._resolveConnectionTeardown({ emitUserFailForPending: false });
      uiManager.showIdError("Peer ID not found");
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

  _getCandidateConnection(payload) {
    const connections = [this.pendingPeerConnection, this.peerConnection];

    for (const connection of connections) {
      if (this._isCandidateForConnection(connection, payload)) {
        return connection;
      }
    }

    return null;
  }

  _isAnswerForPendingConnection(payload) {
    if (!this.pendingPeerConnection || !payload) {
      return false;
    }

    const sourcePeer = payload.callee || payload.from || payload.caller || null;
    if (!sourcePeer) {
      return false;
    }

    if (this.pendingPeerConnection._peerId === sourcePeer) {
      return true;
    }

    if (
      payload.targetSocketId &&
      this.pendingPeerConnection._peerId === payload.targetSocketId
    ) {
      return true;
    }

    return false;
  }

  _copyToClipboard(text, errorContext) {
    if (!this.selfId) {
      uiManager.showIdError("No ID to copy yet");
      return;
    }

    navigator.clipboard
      .writeText(text)
      .then(() => uiManager.showCopied())
      .catch((error) => console.error(`Error copying ${errorContext}:`, error));
  }

  buildShareLink() {
    if (!this.selfId) {
      return null;
    }
    return `${window.location.origin}${window.location.pathname}?peer=${this.selfId}`;
  }

  copyId() {
    this._copyToClipboard(this.selfId, "ID");
  }

  copyLink() {
    const url = this.buildShareLink();
    if (!url) {
      uiManager.showIdError("No ID to share yet");
      return;
    }
    this._copyToClipboard(url, "Link");
  }

  toggleQrCode() {
    if (!this.selfId) {
      uiManager.showIdError("No ID to share yet");
      return;
    }

    const shown = uiManager.toggleQrCodeForId(this.buildShareLink());
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
      uiManager.showIdError("Invalid peer PIN/ID");
      return;
    }
    if (peerId === this.selfId) {
      uiManager.showIdError("Cannot connect to yourself");
      return;
    }
    if (peerId === this.activePeerId) {
      uiManager.showIdError("Already connected");
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

    this.connectionStartTime = performance.now();

    this.newConnTimer = setTimeout(() => {
      if (attemptId !== this.connectionAttemptId) return;
      uiManager.showIdError("Connection timed out");
      this.abortPendingConnection(true);
      statsService.requestConnectionStats();
    }, CONNECTION_TIMEOUT);

    try {
      await turnService.awaitReady();
    } catch (err) {
      console.warn(
        "TURN credential refresh failed, using existing config:",
        err,
      );
    }
    if (this._isStaleAttempt(attemptId)) return;
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
      this._handlePendingConnectionError({
        attemptId,
        error: err,
        logMessage: "Error creating offer:",
        userMessage: "Failed to create connection offer.",
      });
    }
  }

  async handleOffer(data) {
    const isIceRestart =
      this.peerConnection &&
      this.peerConnection._peerId === data.caller &&
      (this.peerConnection.iceConnectionState === "failed" ||
        this.peerConnection.iceConnectionState === "disconnected");

    const isLikelyIceRestart =
      this.peerConnection &&
      this.peerConnection._peerId === data.caller &&
      data.sdp?.type === "offer" &&
      this.peerConnection.connectionState === "connected" &&
      this.peerConnection.iceConnectionState !== "failed" &&
      this.peerConnection.iceConnectionState !== "disconnected" &&
      this.peerConnection.signalingState === "stable";

    const hasFullyConnectedSamePeer =
      this.peerConnection &&
      this.peerConnection._peerId === data.caller &&
      this.peerConnection.connectionState === "connected";

    if (hasFullyConnectedSamePeer && !isIceRestart && !isLikelyIceRestart) {
      console.warn("Ignoring offer: already connected to this peer.");
      return;
    }

    if (isIceRestart || isLikelyIceRestart) {
      return this._handleIceRestartOffer(data);
    }

    if (data.sdp?.type !== "offer") {
      console.warn("Ignoring signal: expected SDP offer, got", data.sdp?.type);
      return;
    }

    const isGlare =
      this.pendingPeerConnection &&
      this.pendingPeerConnection._peerId === data.caller;
    if (isGlare) {
      if (this.selfId && data.caller && this.selfId > data.caller) {
        console.warn("Glare detected and resolved: ignoring incoming offer.");
        return;
      }
      console.warn("Glare detected and resolved: yielding to incoming offer.");
    }

    if (fileTransferManager) {
      fileTransferManager.clearFileSelection();
    }

    uiManager.clearAlert();

    const hadPending = Boolean(
      this.pendingPeerConnection ||
      this.pendingDataChannel ||
      this.pendingControlChannel ||
      this.newConnTimer,
    );
    this.abortPendingConnection(hadPending, { incrementAttemptId: false });
    if (this.peerConnection) {
      this.resetCurrentConnection();
    }

    const attemptId = ++this.connectionAttemptId;

    const offerReceivedTime = performance.now();

    try {
      await turnService.awaitReady();
    } catch (err) {
      console.warn(
        "TURN credential refresh failed, using existing config:",
        err,
      );
    }
    this.peerConnection = new RTCPeerConnection(turnService.getRtcConfig());
    this.configureConnection(this.peerConnection, data.caller, false);

    try {
      await this.peerConnection.setRemoteDescription(data.sdp);
      if (this._isStaleAttempt(attemptId)) return;
      await this.drainCandidateQueue(this.peerConnection);
      if (this._isStaleAttempt(attemptId)) return;
      const ans = await this.peerConnection.createAnswer();
      if (this._isStaleAttempt(attemptId)) return;
      await this.peerConnection.setLocalDescription(ans);
      if (this._isStaleAttempt(attemptId)) return;

      if (!this.connectionStartTime) {
        this.connectionStartTime = offerReceivedTime;
        this.answerReceivedTime = performance.now();
        this.signalingDuration =
          this.answerReceivedTime - this.connectionStartTime;
      }

      this.socket.emit("answer", {
        target: data.caller,
        sdp: this.peerConnection.localDescription,
      });
      this.activePeerId = data.caller;
    } catch (err) {
      if (this._isStaleAttempt(attemptId)) {
        return;
      }
      console.error("Error handling offer:", err);
      this.resetConnectionTiming();
      this.resetCurrentConnection();
    }
  }

  async _handleIceRestartOffer(data) {
    console.warn("Accepting ICE restart offer from active peer.");
    const conn = this.peerConnection;
    if (!conn) return;

    if (data.sdp?.type !== "offer") {
      console.warn(
        "Ignoring ICE restart: expected SDP offer, got",
        data.sdp?.type,
      );
      return;
    }

    try {
      if (Array.isArray(conn._candidateQueue)) {
        conn._candidateQueue.length = 0;
      }
      await conn.setRemoteDescription(data.sdp);
      const ans = await conn.createAnswer();
      await conn.setLocalDescription(ans);

      this.socket.emit("answer", {
        target: data.caller,
        sdp: conn.localDescription,
      });
    } catch (error) {
      console.error("ICE restart on responder failed:", error);
      this.resetCurrentConnection();
    }
  }

  async handleAnswer(data) {
    if (!this.pendingPeerConnection) {
      return this._handleIceRestartAnswer(data);
    }

    const currentAttemptId = this.connectionAttemptId;

    if (this._isStaleAttempt(currentAttemptId)) {
      return;
    }

    if (!this._isAnswerForPendingConnection(data)) {
      return;
    }

    if (this.pendingPeerConnection.signalingState !== "have-local-offer") {
      console.warn(
        "Ignoring answer: pending connection not in have-local-offer state.",
      );
      return;
    }

    if (data.sdp?.type !== "answer") {
      console.warn("Ignoring answer: expected SDP answer, got", data.sdp?.type);
      return;
    }

    if (this.activePeerId) {
      this.resetCurrentConnection();
    }

    this.answerReceivedTime = performance.now();

    if (this.connectionStartTime) {
      this.signalingDuration =
        this.answerReceivedTime - this.connectionStartTime;
    }

    try {
      await this.pendingPeerConnection.setRemoteDescription(data.sdp);
      await this.drainCandidateQueue(this.pendingPeerConnection);
    } catch (err) {
      this._handlePendingConnectionError({
        attemptId: currentAttemptId,
        error: err,
        logMessage: "Error applying remote description:",
        userMessage: "Failed to establish connection.",
      });
      return;
    }

    if (this._isStaleAttempt(currentAttemptId)) {
      return;
    }

    if (!this.pendingPeerConnection) {
      return;
    }

    if (typeof data.callee !== "string" || data.callee.trim() === "") {
      console.warn("Ignoring answer: invalid callee field");
      return;
    }
    if (data.callee !== this.pendingPeerConnection._peerId) {
      console.warn("Ignoring answer: callee does not match intended peer");
      return;
    }

    if (this._isStaleAttempt(currentAttemptId)) {
      return;
    }

    this.activePeerId = data.callee;

    this.peerConnection = this.pendingPeerConnection;
    this.dataChannel = this.pendingDataChannel;
    this.controlChannel = this.pendingControlChannel;
    this.pendingPeerConnection = null;
    this.pendingDataChannel = null;
    this.pendingControlChannel = null;

    this._attachDataChannelOpenHandler(this.dataChannel, this.controlChannel);
  }

  async _handleIceRestartAnswer(data) {
    const conn = this.peerConnection;
    if (!conn) return;

    const sourcePeer = data.callee || data.from || null;
    if (!sourcePeer || conn._peerId !== sourcePeer) return;

    if (data.sdp?.type !== "answer") {
      console.warn(
        "Ignoring ICE restart answer: expected SDP answer, got",
        data.sdp?.type,
      );
      return;
    }

    if (conn.signalingState !== "have-local-offer") return;

    try {
      await conn.setRemoteDescription(data.sdp);
      await this.drainCandidateQueue(conn);

      conn._failureHandling = false;
    } catch (error) {
      console.error("ICE restart answer failed:", error);
      this.resetCurrentConnection();
    }
  }

  _attachDataChannelOpenHandler(dataChannel, controlChannel) {
    const tryEmitSuccess = () => {
      if (
        this._pendingSuccessEmit &&
        this.peerConnection &&
        !this.peerConnection._successEmitted
      ) {
        if (
          this.dataChannel?.readyState === "open" &&
          this.controlChannel?.readyState === "open"
        ) {
          this.peerConnection._successEmitted = true;
          this._pendingSuccessEmit = false;
          this.socket.emit("connection-success");
          statsService.requestConnectionStats({ force: true });
        }
      }
    };

    const tryStartHandshake = () => {
      if (
        this.encryption.enabled &&
        !this.encryption.sessionKey &&
        this.dataChannel?.readyState === "open" &&
        this.controlChannel?.readyState === "open" &&
        this.activePeerId
      ) {
        this._beginEncryptionHandshake(this.activePeerId);
      }
    };

    if (dataChannel) {
      if (dataChannel.readyState === "open") {
        tryEmitSuccess();
      } else {
        dataChannel.addEventListener("open", tryEmitSuccess);
      }
    }
    if (controlChannel) {
      if (controlChannel.readyState === "open") {
        tryEmitSuccess();
      } else {
        controlChannel.addEventListener("open", tryEmitSuccess);
      }
    }

    if (dataChannel) {
      if (dataChannel.readyState === "open") {
        tryStartHandshake();
      } else {
        dataChannel.addEventListener("open", tryStartHandshake);
      }
    }
    if (controlChannel) {
      if (controlChannel.readyState === "open") {
        tryStartHandshake();
      } else {
        controlChannel.addEventListener("open", tryStartHandshake);
      }
    }
  }

  _checkAndEmitSuccess(conn) {
    if (
      this.dataChannel?.readyState === "open" &&
      this.controlChannel?.readyState === "open"
    ) {
      if (!conn._successEmitted) {
        conn._successEmitted = true;
        this.socket.emit("connection-success");
        statsService.requestConnectionStats({ force: true });
      }
    } else {
      this._pendingSuccessEmit = true;
    }
  }

  async drainCandidateQueue(connection) {
    if (!connection) {
      return;
    }

    if (!Array.isArray(connection._candidateQueue)) {
      connection._candidateQueue = [];
    }

    while (connection._candidateQueue.length) {
      const candidate = connection._candidateQueue.shift();
      try {
        if (connection.signalingState !== "closed") {
          await connection.addIceCandidate(candidate || null);
        }
      } catch (error) {
        console.error("Failed to drain ICE candidate queue:", error);
      }
    }
  }

  async handleConnectionFailure(conn) {
    if (conn._failureHandling) return;
    conn._failureHandling = true;

    statsService.requestConnectionStats();
    if (conn === this.pendingPeerConnection) {
      this.abortPendingConnection(true);
      conn._failureHandling = false;
    } else if (conn === this.peerConnection) {
      if (conn.iceConnectionState === "failed") {
        this._clearDisconnectTimer();
        if (conn._isInitiator) {
          console.warn(
            "ICE Connection failed on initiator. Attempting ICE Restart...",
          );
          try {
            const offer = await conn.createOffer({ iceRestart: true });
            await conn.setLocalDescription(offer);

            conn._failureHandling = false;
            this.socket.emit("offer", {
              target: conn._peerId,
              sdp: conn.localDescription,
            });
          } catch (error) {
            console.error("ICE Restart failed:", error);
            conn._failureHandling = false;
            this.resetCurrentConnection();
          }
        } else {
          console.warn(
            "ICE Connection failed on responder. Attempting ICE Restart...",
          );
          try {
            const originalIsInitiator = conn._isInitiator;
            conn._isInitiator = true;
            const offer = await conn.createOffer({ iceRestart: true });
            await conn.setLocalDescription(offer);

            conn._failureHandling = false;

            conn._isInitiator = originalIsInitiator;
            this.socket.emit("offer", {
              target: conn._peerId,
              sdp: conn.localDescription,
            });
          } catch (error) {
            console.error("Responder ICE Restart failed:", error);
            conn._failureHandling = false;
            this.resetCurrentConnection();
          }
        }
      } else {
        conn._failureHandling = false;
        this.resetCurrentConnection();
      }
    }
  }

  configureConnection(conn, targetId, isInitiator) {
    conn._successEmitted = false;
    conn._failureHandling = false;
    conn._peerId = targetId;
    conn._isInitiator = isInitiator;
    conn._candidateQueue = [];

    const earlyCandidates = this._pendingCandidates.get(targetId);
    if (Array.isArray(earlyCandidates) && earlyCandidates.length > 0) {
      conn._candidateQueue.push(...earlyCandidates);
      this._pendingCandidates.delete(targetId);
    }

    conn.onicecandidate = (evt) => {
      this.socket.emit("candidate", {
        target: targetId,
        candidate: evt.candidate,
      });
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
      if (!isInitiator) {
        this._attachDataChannelOpenHandler(
          this.dataChannel,
          this.controlChannel,
        );
        this._checkAndEmitSuccess(conn);
      }
    };

    conn.onconnectionstatechange = () => {
      this._clearDisconnectTimer();

      if (conn.connectionState === "connected") {
        conn._failureHandling = false;
        this.startHeartbeat();
        this._checkAndEmitSuccess(conn);

        if (this.connectionStartTime) {
          this.totalConnectionDuration =
            performance.now() - this.connectionStartTime;

          if (!this.signalingDuration && this.answerReceivedTime) {
            this.signalingDuration =
              this.answerReceivedTime - this.connectionStartTime;
          }

          this.logConnectionStats(isInitiator);
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
        conn._failureHandling = false;
        this.handleConnectionFailure(conn);
      }
    };

    conn.oniceconnectionstatechange = () => {
      if (conn.iceConnectionState === "disconnected") {
        console.warn("ICE connection disconnected, attempting to recover...");
        if (
          typeof fileTransferManager !== "undefined" &&
          fileTransferManager &&
          (fileTransferManager.isSending || fileTransferManager.isReceiving) &&
          !fileTransferManager.isPaused &&
          !fileTransferManager.isStopped
        ) {
          fileTransferManager.isIcePaused = true;
          fileTransferManager.isPaused = true;
        }
        if (!this.disconnectTimer) {
          this.disconnectTimer = setTimeout(() => {
            if (
              conn.iceConnectionState !== "connected" &&
              conn.iceConnectionState !== "completed"
            ) {
              this.handleConnectionFailure(conn);
            }
          }, CONNECTION_RECOVERY_DELAY);
        }
      } else if (
        conn.iceConnectionState === "connected" ||
        conn.iceConnectionState === "completed"
      ) {
        this._clearDisconnectTimer();

        if (conn._failureHandling) {
          conn._failureHandling = false;
        }

        if (
          typeof fileTransferManager !== "undefined" &&
          fileTransferManager &&
          fileTransferManager.isIcePaused &&
          !fileTransferManager.isStopped
        ) {
          console.warn("ICE connection recovered, auto-resuming transfer");
          fileTransferManager.isIcePaused = false;
          fileTransferManager.isPaused = false;
          if (fileTransferManager.isReceiving)
            fileTransferManager.sendResumeOffsetSync();
        }
      } else if (conn.iceConnectionState === "failed") {
        conn._failureHandling = false;
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
    this._attachChannelMessageHandler(channel);
    channel.onclose = () => {
      this._handleChannelClose(channel);
    };
  }

  initializeDataChannel(channel) {
    channel.bufferedAmountLowThreshold =
      DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD;
    channel.binaryType = "arraybuffer";
    this._attachChannelMessageHandler(channel);
    channel.onclose = () => {
      this._handleChannelClose(channel);
    };
  }

  _handleChannelClose(channel) {
    if (
      channel === this.dataChannel ||
      channel === this.controlChannel ||
      channel === this.pendingDataChannel ||
      channel === this.pendingControlChannel
    ) {
      if (
        this.peerConnection &&
        this.peerConnection.connectionState !== "closed" &&
        this.peerConnection.connectionState !== "failed" &&
        !this.peerConnection._failureHandling
      ) {
        console.warn(
          "Data channel closed unexpectedly, treating connection as failed",
        );
        this.handleConnectionFailure(this.peerConnection);
      } else if (
        this.pendingPeerConnection &&
        this.pendingPeerConnection.connectionState !== "closed" &&
        this.pendingPeerConnection.connectionState !== "failed" &&
        !this.pendingPeerConnection._failureHandling
      ) {
        console.warn(
          "Data channel closed unexpectedly during pending connection",
        );
        this.handleConnectionFailure(this.pendingPeerConnection);
      }
    }
  }

  processIncomingChannelMessage(rawMessage) {
    if (typeof rawMessage !== "string") {
      if (this.encryption.sessionKey) {
        this._processEncryptedWrapper({
          type: "e2e-chunk",
          payload: Array.from(new Uint8Array(rawMessage)),
        });
        return;
      }
      fileTransferManager?.handleIncomingData(rawMessage);
      return;
    }

    const message = appUtils.safeJsonParse(rawMessage);

    if (message && message.type === "e2e-chunk") {
      this._processEncryptedWrapper(message);
      return;
    }

    if (this._isHandshakeMessage(message)) {
      if (message.type === "e2e-hello") {
        this._handleE2EHello(this.activePeerId, message);
      } else if (message.type === "e2e-key") {
        this._handleE2EKey(this.activePeerId, message);
      }
      return;
    }

    if (message && this.handleControlMessage(message)) {
      return;
    }

    const outOfBandTypes = [
      "throttle-pause",
      "throttle-resume",
      "pause-transfer",
      "resume-transfer",
      "cancel-transfer",
    ];
    if (message && outOfBandTypes.includes(message.type)) {
      if (fileTransferManager) {
        fileTransferManager
          .processControlInstruction(rawMessage)
          .catch(console.error);
      }
      return;
    }

    fileTransferManager?.handleIncomingData(rawMessage);
  }

  sendControlMessage(msgObj) {
    if (this._isHandshakeMessage(msgObj)) {
      this._sendPlaintextControlMessage(JSON.stringify(msgObj));
      return;
    }

    if (this.encryption.enabled && this.encryption.sessionKey) {
      if (msgObj.type === "disconnect") {
        this._sendPlaintextControlMessage(JSON.stringify(msgObj));
        return;
      }
      encryptMessage(this.encryption.sessionKey, msgObj)
        .then((payload) =>
          this._sendEncryptedPayload(payload, ENCRYPTION_TAGS.CONTROL),
        )
        .catch((error) => {
          console.warn("Failed to encrypt control message:", error);
          this._sendPlaintextControlMessage(JSON.stringify(msgObj));
        });
      return;
    }

    this._sendPlaintextControlMessage(JSON.stringify(msgObj));
  }

  _sendPlaintextControlMessage(payload) {
    if (this.controlChannel && this.controlChannel.readyState === "open") {
      this.controlChannel.send(payload);
    } else if (this.dataChannel && this.dataChannel.readyState === "open") {
      this.dataChannel.send(payload);
    }
  }

  handleControlMessage(message) {
    switch (message.type) {
      case "e2e-hello":
        this._handleE2EHello(this.activePeerId, message);
        return true;
      case "e2e-key":
        this._handleE2EKey(this.activePeerId, message);
        return true;
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
        this._lastPongAt = Date.now();
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
    this._resolveConnectionTeardown();
  }

  abortPendingConnection(emitUserFail = true, options = {}) {
    const { incrementAttemptId = true } = options;
    const hadPendingAttempt = Boolean(
      this.pendingPeerConnection ||
      this.pendingDataChannel ||
      this.pendingControlChannel ||
      this.newConnTimer,
    );

    uiManager.clearAlert();
    this._clearNewConnectionTimer();
    if (hadPendingAttempt && incrementAttemptId) {
      this.connectionAttemptId++;
    }

    if (!this.peerConnection) {
      this._cleanupFileTransfer();
      this._resetEncryptionState();
    }

    if (emitUserFail && hadPendingAttempt) {
      this.socket.emit("connection-user-failed");
    }

    statsService.requestConnectionStats({ force: true });
    this._pendingSuccessEmit = false;
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
    this._clearDisconnectTimer();
    uiManager.clearAlert();
    this._clearNewConnectionTimer();
    this.pendingServerDisconnect = null;
    this._pendingCandidates.clear();
    this._resetEncryptionState();

    this._cleanupFileTransfer({ clearSelection: true });

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

    if (this._pendingSuccessEmit) {
      this._pendingSuccessEmit = false;
      this.socket.emit("connection-user-failed");
    }

    statsService.requestConnectionStats({ force: true });
    uiManager.updateToIdle();
  }

  resetConnectionTiming() {
    this.connectionStartTime = null;
    this.answerReceivedTime = null;
    this.signalingDuration = null;
    this.totalConnectionDuration = null;
  }

  logConnectionStats(isInitiator = false) {
    if (this.signalingDuration && this.totalConnectionDuration) {
      const signaling = Math.round(this.signalingDuration);
      const webRTCNegotiation = Math.round(
        this.totalConnectionDuration - this.signalingDuration,
      );
      const total = Math.round(this.totalConnectionDuration);

      const peerDisplay =
        typeof uiManager !== "undefined" && uiManager.getPeerDisplayLabel
          ? uiManager.getPeerDisplayLabel(this.activePeerId)
          : this.activePeerId;

      const signalingLabel = isInitiator
        ? "Signaling Duration (Round-Trip)"
        : "Signaling Duration (Processing)";

      console.log(`Connection Timing Stats for ${peerDisplay}:
    - ${signalingLabel}: ${signaling}ms
    - WebRTC Negotiation: ${webRTCNegotiation}ms
    - Total Connection Duration: ${total}ms`);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this._lastPongAt = Date.now();
    this._pongTimeout = null;

    this.heartbeatInterval = setInterval(() => {
      try {
        if (
          this._lastPongAt &&
          Date.now() - this._lastPongAt > HEARTBEAT_INTERVAL * 3
        ) {
          console.warn(
            "No pong received for 3 heartbeat intervals, treating connection as dead",
          );
          this.stopHeartbeat();
          if (this.peerConnection) {
            this.handleConnectionFailure(this.peerConnection);
          }
          return;
        }
        this.sendControlMessage({ type: "ping" });
      } catch (heartbeatError) {
        console.warn("Heartbeat failed", heartbeatError);
      }
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this._lastPongAt = null;
  }

  cleanup(options = {}) {
    const { disposeSocket = false } = options;

    this.stopHeartbeat();

    this._clearDisconnectTimer();
    this._clearNewConnectionTimer();

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
        this.socket.disconnect();
      } catch (error) {
        console.error("Socket disconnect() failed during cleanup:", error);
      }
    }
  }
}

export const webrtcManager = new WebRTCManager();
