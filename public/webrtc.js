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
// how long until letting user the other peer could not be found
let newConnTimer = null;

let peerConnection = null;
let dataChannel = null;
let pendingPeerConnection = null;
let pendingDataChannel = null;

let activePeerId = null;
let selfId = null;

// ICE servers
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

function showCopyConfirmation() {
  clearTimeout(copyMsgTimer);
  clearTimeout(idMsgTimer);
  statusIdMessage.textContent = "Copied";
  statusIdMessage.style.display = "inline-block";
  statusIdMessage.style.border = "";
  statusIdMessage.style.color = "black";
  statusIdMessage.style.padding = "";
  statusIdMessage.style.fontSize = "0.8rem";
  copyMsgTimer = setTimeout(resetIdMessage, 4000);
}

function showIdError(msg) {
  clearTimeout(copyMsgTimer);
  clearTimeout(idMsgTimer);
  statusIdMessage.textContent = msg;
  statusIdMessage.style.display = "inline-block";
  statusIdMessage.style.border = "1.5px solid red";
  statusIdMessage.style.color = "red";
  statusIdMessage.style.padding = "1px 2px";
  statusIdMessage.style.fontSize = "0.7rem";
  idMsgTimer = setTimeout(resetIdMessage, 4000);
}

function resetIdMessage() {
  clearTimeout(copyMsgTimer);
  clearTimeout(idMsgTimer);
  statusIdMessage.textContent = "";
  statusIdMessage.style.display = "none";
  statusIdMessage.style.border = "";
  statusIdMessage.style.color = "";
  statusIdMessage.style.padding = "";
  statusIdMessage.style.fontSize = "";
}

// for connection panel
function updateConnectionUI(opts) {
  activeConnectionContainer.style.display = opts.containerDisplay;
  activeConnectionContainer.style.gap = opts.gap || "";
  activeConnectionLabel.textContent = opts.labelText || "";
  activeConnectionStatus.textContent = opts.statusText || "";

  activeConnectionStatus.style.textDecoration =
    opts.textDecoration || "";
  activeConnectionStatus.style.textDecorationColor =
    opts.textDecorationColor || "";
  activeConnectionStatus.style.textDecorationThickness =
    opts.textDecorationThickness || "";

  endTrigger.textContent = opts.endTriggerText || "";
  endTrigger.style.display = opts.endTriggerDisplay || "none";
}

function resetConnectionUI() {
  uploadField.value = "";
  fileTransferSection.style.display = "none";
  activeConnectionContainer.style.display = "none";
  activeConnectionStatus.textContent = "None";
  endTrigger.style.display = "none";
}

// close in progress offer/answer attempts
function abortPendingConnection() {
  clearTimeout(newConnTimer);
  clearTimeout(fileMsgTimer);
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
    updateConnectionUI({
      containerDisplay: "flex",
      gap: "10px",
      labelText: "Connected to:",
      statusText: `${activePeerId}`,
      endTriggerText: "Disconnect",
      endTriggerDisplay: "inline-block",
    });
  }
}

// close current connection completely
// The parameter sendDisconnect (default true) determines whether to send a disconnect message.
function resetCurrentConnection(sendDisconnect = true) {
  if (sendDisconnect && dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify({ type: "disconnect" }));
  }
  clearTimeout(fileMsgTimer);
  clearTimeout(newConnTimer);
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
  resetConnectionUI();
}

function resetAllConnections() {
  resetCurrentConnection();
  abortPendingConnection();
}

// assign self socket id
socket.on("connect", () => {
  selfId = socket.id;
  myIdDisplay.textContent = selfId;
  copyIdTrigger.addEventListener("click", () => {
    navigator.clipboard
      .writeText(selfId)
      .then(showCopyConfirmation)
      .catch((error) => console.error("Error copying ID:", error));
  });
});

// handles an offer from a peer
// creates our side of the connection
socket.on("offer", async (data) => {
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
    updateConnectionUI({
      containerDisplay: "flex",
      gap: "10px",
      labelText: "Connected to:",
      statusText: `${activePeerId}`,
      textDecoration: "underline",
      textDecorationColor: "#27ae60",
      textDecorationThickness: "3px",
      endTriggerText: "Disconnect",
      endTriggerDisplay: "inline-block",
      fileTransferSectionDisplay: "block",
    });
    setTimeout(() => {
      activeConnectionStatus.style.textDecoration = "";
      activeConnectionStatus.style.textDecorationColor = "";
      activeConnectionStatus.style.textDecorationThickness = "";
    }, 4000);
  
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

    updateConnectionUI({
      containerDisplay: "flex",
      gap: "10px",
      labelText: "Connected to:",
      statusText: `${activePeerId}`,
      textDecoration: "underline",
      textDecorationColor: "#27ae60",
      textDecorationThickness: "3px",
      endTriggerText: "Disconnect",
      endTriggerDisplay: "inline-block",
    });
    fileTransferSection.style.display = "block";
    setTimeout(() => {
      activeConnectionStatus.style.textDecoration = "";
      activeConnectionStatus.style.textDecorationColor = "";
      activeConnectionStatus.style.textDecorationThickness = "";
    }, 4000);
  } catch (err) {
    console.error("Error applying remote description:", err);
  }
});

// get ICE candiates from a peer
socket.on("candidate", (data) => {
  const targetConnection = pendingPeerConnection || peerConnection;
  if (targetConnection) {
    targetConnection
      .addIceCandidate(data.candidate)
      .catch((e) => console.error(e));
  }
});

// initialize shred event listeners and data channel
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

// sets up data channel to handle control messages or file chunks
function initializeDataChannel(channel) {
  channel.binaryType = "arraybuffer";
  channel.onmessage = (evt) => {
    if (typeof evt.data === "string") {
      try {
        const message = JSON.parse(evt.data);
        if (message.type === "disconnect") {
          resetCurrentConnection(false);
          return;
        }
      } catch (e) {}
      processControlInstruction(evt.data);
    } else {
      processIncomingChunk(evt.data);
    }
  };
}

// enable connect button if valid
partnerIdField.addEventListener("input", () => {
  connectTrigger.disabled = partnerIdField.value.trim() === "";
});

// initiate a connection attempt
connectTrigger.addEventListener("click", () => {
  const peerId = partnerIdField.value.trim();
  partnerIdField.value = "";
  connectTrigger.disabled = true;

  if (!/^[a-zA-Z0-9_-]+$/.test(peerId)) {
    showIdError("Invalid peer ID!");
    return;
  }
  if (peerId === selfId) {
    showIdError("Cannot connect to yourself.");
    return;
  }
  if (peerId === activePeerId) {
    showIdError("Already connected.");
    return;
  }

  resetIdMessage();
  abortPendingConnection();
  updateConnectionUI({
    containerDisplay: "flex",
    gap: "0",
    labelText: "",
    statusText: "Waiting for peer...",
    endTriggerText: "Cancel",
    endTriggerDisplay: "inline-block",
  });
  newConnTimer = setTimeout(() => {
    showIdError("Connection timed out.");
    abortPendingConnection();
  }, 15000);

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
  resetIdMessage();
  if (!peerConnection) {
    resetConnectionUI();
  }
  if (pendingPeerConnection) {
    abortPendingConnection();
  } else {
    resetCurrentConnection();
  }
});

window.addEventListener("beforeunload", () => {
  if (activePeerId) {
    resetAllConnections();
  }
});
