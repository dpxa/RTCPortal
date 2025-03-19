const socket = environmentIsProd
  ? io("https://rtcportal.onrender.com", {
      transports: ["websocket", "polling"],
    })
  : io();

const myIdDisplay = document.getElementById("myIdDisplay");
const copyIdTrigger = document.getElementById("copyIdTrigger");
const statusIdMessage = document.getElementById("statusIdMessage");
const partnerIdField = document.getElementById("partnerIdField");
const activeConnectionContainer = document.getElementById(
  "activeConnectionContainer"
);
const connectTrigger = document.getElementById("connectTrigger");
const endTrigger = document.getElementById("endTrigger");
const activeConnectionLabel = document.getElementById("activeConnectionLabel");
const activeConnectionStatus = document.getElementById(
  "activeConnectionStatus"
);
const fileTransferSection = document.getElementById("fileTransferSection");

let copyMsgTimer = null;
let idMsgTimer = null;
let newConnTimer = null;

let peerConnection = null;
let dataChannel = null;
let pendingPeerConnection = null;
let pendingDataChannel = null;
let activePeerId = null;
let selfId = null;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

const uiManager = {
  showStatus(message) {
    clearTimeout(copyMsgTimer);
    clearTimeout(idMsgTimer);
    statusIdMessage.textContent = message;
    statusIdMessage.style.display = "inline-block";
    statusIdMessage.style.border = "1px solid #ccc";
    statusIdMessage.style.color = "black";
    statusIdMessage.style.padding = "2px 4px";
    statusIdMessage.style.fontSize = "0.8rem";
    idMsgTimer = setTimeout(() => this.resetStatus(), 4000);
  },

  showIdError(msg) {
    statusIdMessage.textContent = msg;
    statusIdMessage.style.display = "inline-block";
    statusIdMessage.style.border = "1.5px solid red";
    statusIdMessage.style.color = "red";
    statusIdMessage.style.padding = "1px 2px";
    statusIdMessage.style.fontSize = "0.7rem";
    idMsgTimer = setTimeout(() => uiManager.resetStatus(), 4000);
  },

  resetStatus() {
    clearTimeout(idMsgTimer);
    clearTimeout(copyMsgTimer);
    statusIdMessage.textContent = "";
    statusIdMessage.style.display = "none";
    statusIdMessage.style.border = "";
    statusIdMessage.style.color = "";
    statusIdMessage.style.padding = "";
    statusIdMessage.style.fontSize = "";
  },

  updateToIdle() {
    fileTransferUI.clearAlert();
    uploadField.value = "";
    activeConnectionContainer.style.display = "none";
    activeConnectionStatus.textContent = "None";
    endTrigger.style.display = "none";
    fileTransferSection.style.display = "none";
  },

  updateToWaiting() {
    activeConnectionContainer.style.display = "flex";
    activeConnectionContainer.style.gap = "0";
    activeConnectionLabel.textContent = "";
    activeConnectionStatus.textContent = "Waiting for peer...";
    activeConnectionStatus.style.textDecoration = "";
    activeConnectionStatus.style.textDecorationColor = "";
    activeConnectionStatus.style.textDecorationThickness = "";
    endTrigger.textContent = "Cancel";
    endTrigger.style.display = "inline-block";
  },

  updateToConnected(peerId) {
    activeConnectionContainer.style.display = "flex";
    activeConnectionContainer.style.gap = "10px";
    activeConnectionLabel.textContent = "Connected to:";
    activeConnectionStatus.textContent = peerId;
    activeConnectionStatus.style.textDecoration = "underline";
    activeConnectionStatus.style.textDecorationColor = "#27ae60";
    activeConnectionStatus.style.textDecorationThickness = "3px";
    endTrigger.textContent = "Disconnect";
    endTrigger.style.display = "inline-block";
    fileTransferSection.style.display = "block";
    fileTransferTrigger.disabled = true;

    setTimeout(() => {
      activeConnectionStatus.style.textDecoration = "";
      activeConnectionStatus.style.textDecorationColor = "";
      activeConnectionStatus.style.textDecorationThickness = "";
    }, 4000);
  },
};

socket.on("connect", () => {
  selfId = socket.id;
  myIdDisplay.textContent = selfId;
  copyIdTrigger.addEventListener("click", () => {
    navigator.clipboard
      .writeText(selfId)
      .then(() => uiManager.showStatus("Copied"))
      .catch((error) => console.error("Error copying ID:", error));
  });
});

function abortPendingConnection() {
  uiManager.resetStatus();
  clearTimeout(newConnTimer);
  if (pendingPeerConnection) {
    pendingPeerConnection.onicecandidate = null;
    pendingPeerConnection.ondatachannel = null;
    pendingPeerConnection.onconnectionstatechange = null;
    pendingPeerConnection.close();
    pendingPeerConnection = null;
  }
  if (pendingDataChannel) {
    pendingDataChannel.close();
    pendingDataChannel = null;
  }
  if (peerConnection) {
    uiManager.updateToConnected(activePeerId);
  }
}

function resetCurrentConnection() {
  uiManager.resetStatus();
  clearTimeout(newConnTimer);
  clearTimeout(fileMsgTimer);
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify({ type: "disconnect" }));
  }
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ondatachannel = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  activePeerId = null;
  uiManager.updateToIdle();
}

socket.on("offer", async (data) => {
  uiManager.resetStatus();
  abortPendingConnection();
  if (peerConnection) {
    resetCurrentConnection();
  }
  peerConnection = new RTCPeerConnection(rtcConfig);
  configureConnection(peerConnection, data.caller, false);
  try {
    await peerConnection.setRemoteDescription(data.sdp);
    const ans = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(ans);
    activePeerId = data.caller;
    clearTimeout(newConnTimer);
    uiManager.updateToConnected(activePeerId);
    socket.emit("answer", {
      target: data.caller,
      sdp: peerConnection.localDescription,
    });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
});

socket.on("answer", async (data) => {
  try {
    if (activePeerId) {
      resetCurrentConnection();
    }
    await pendingPeerConnection.setRemoteDescription(data.sdp);
    peerConnection = pendingPeerConnection;
    dataChannel = pendingDataChannel;
    pendingPeerConnection = null;
    pendingDataChannel = null;
    activePeerId = data.callee;
    uiManager.updateToConnected(activePeerId);
    fileTransferSection.style.display = "block";
  } catch (err) {
    console.error("Error applying remote description:", err);
  }
});

socket.on("candidate", (data) => {
  const targetConnection = pendingPeerConnection || peerConnection;
  if (targetConnection) {
    targetConnection
      .addIceCandidate(data.candidate)
      .catch((e) => console.error(e));
  }
});

function configureConnection(conn, targetId, isInitiator) {
  conn.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit("candidate", { target: targetId, candidate: evt.candidate });
    }
  };
  conn.ondatachannel = (evt) => {
    const channel = evt.channel;
    initializeDataChannel(channel);
    if (!isInitiator) {
      dataChannel = channel;
    }
  };
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected") {
      clearTimeout(newConnTimer);
      fileTransferSection.style.display = "block";
      endTrigger.style.display = "inline-block";
      endTrigger.textContent = "Disconnect";
    } else if (["disconnected", "failed"].includes(conn.connectionState)) {
      if (conn === pendingPeerConnection) {
        abortPendingConnection();
      } else if (conn === peerConnection) {
        resetCurrentConnection();
      }
    }
  };
  if (isInitiator) {
    pendingDataChannel = conn.createDataChannel("fileChannel");
    initializeDataChannel(pendingDataChannel);
  }
}

function initializeDataChannel(channel) {
  channel.binaryType = "arraybuffer";
  channel.onmessage = (evt) => {
    if (typeof evt.data === "string") {
      try {
        const message = JSON.parse(evt.data);
        if (message.type === "disconnect") {
          resetCurrentConnection();
          return;
        }
      } catch (e) {}
      processControlInstruction(evt.data);
    } else {
      processIncomingChunk(evt.data);
    }
  };
}

partnerIdField.addEventListener("input", () => {
  connectTrigger.disabled = partnerIdField.value.trim() === "";
  activeConnectionStatus.style.textDecoration = "";
  activeConnectionStatus.style.textDecorationColor = "";
  activeConnectionStatus.style.textDecorationThickness = "";
});

connectTrigger.addEventListener("click", () => {
  const peerId = partnerIdField.value.trim();
  partnerIdField.value = "";
  connectTrigger.disabled = true;

  if (!/^[a-zA-Z0-9_-]+$/.test(peerId)) {
    uiManager.showIdError("Invalid peer ID!");
    return;
  }
  if (peerId === selfId) {
    uiManager.showIdError("Cannot connect to yourself.");
    return;
  }
  if (peerId === activePeerId) {
    uiManager.showIdError("Already connected.");
    return;
  }

  uiManager.resetStatus();
  abortPendingConnection();
  uiManager.updateToWaiting();
  newConnTimer = setTimeout(() => {
    uiManager.showIdError("Connection timed out.");
    abortPendingConnection();
  }, 30000);

  pendingPeerConnection = new RTCPeerConnection(rtcConfig);
  configureConnection(pendingPeerConnection, peerId, true);
  pendingPeerConnection
    .createOffer()
    .then((offer) => pendingPeerConnection.setLocalDescription(offer))
    .then(() => {
      socket.emit("offer", {
        target: peerId,
        sdp: pendingPeerConnection.localDescription,
      });
    })
    .catch((err) => console.error("Error creating offer:", err));
});

endTrigger.addEventListener("click", () => {
  if (!peerConnection) {
    uiManager.updateToIdle();
  }
  if (pendingPeerConnection) {
    abortPendingConnection();
  } else {
    resetCurrentConnection();
  }
});

window.addEventListener("beforeunload", () => {
  if (activePeerId) {
    resetCurrentConnection();
    abortPendingConnection();
  }
});
