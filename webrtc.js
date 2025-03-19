// Establishes the global socket connection, which is either production or local
const socket = environmentIsProd
  ? io("https://rtcportal.onrender.com", {
      transports: ["websocket", "polling"],
    })
  : io();

// Grabbing page elements for connection and ID display
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

// Timers controlling how long messages are visible
let copyMsgTimer = null;
let idMsgTimer = null;

// Maintain references for active or pending connections
let peerConnection = null;
let dataChannel = null;
let pendingPeerConnection = null;
let pendingDataChannel = null;
let activePeerId = null;
let selfId = null;

// ICE servers used by WebRTC
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

// Timeout references and a flag to avoid race conditions
let connectionWaitTimer = null;
let newConnTimer = null;

// Displays a short confirmation message after copying the user’s ID
function showCopyConfirmation() {
  clearTimeout(copyMsgTimer);
  clearTimeout(idMsgTimer);
  idMsgTimer = null;
  statusIdMessage.textContent = "Copied";
  statusIdMessage.style.display = "inline-block";
  statusIdMessage.style.border = "";
  statusIdMessage.style.color = "black";
  statusIdMessage.style.padding = "";
  statusIdMessage.style.fontSize = "0.8rem";
  copyMsgTimer = setTimeout(resetIdMessage, 4000);
}

// Displays an error message to the user
function showIdError(msg) {
  clearTimeout(copyMsgTimer);
  clearTimeout(idMsgTimer);
  idMsgTimer = null;
  statusIdMessage.textContent = msg;
  statusIdMessage.style.display = "inline-block";
  statusIdMessage.style.border = "1.5px solid red";
  statusIdMessage.style.color = "red";
  statusIdMessage.style.padding = "1px 2px";
  statusIdMessage.style.fontSize = "0.7rem";
  idMsgTimer = setTimeout(resetIdMessage, 4000);
}

// Resets ID message area to hidden
function resetIdMessage() {
  clearTimeout(copyMsgTimer);
  clearTimeout(idMsgTimer);
  idMsgTimer = null;
  statusIdMessage.textContent = "";
  statusIdMessage.style.display = "none";
  statusIdMessage.style.border = "";
  statusIdMessage.style.color = "";
  statusIdMessage.style.padding = "";
  statusIdMessage.style.fontSize = "";
}

// Updates the connection panel's UI
function updateConnectionUI(opts) {
  activeConnectionContainer.style.display = opts.containerDisplay;
  activeConnectionContainer.style.gap = opts.gap || "";
  activeConnectionLabel.textContent = opts.labelText || "";
  activeConnectionStatus.textContent = opts.statusText || "";
  activeConnectionStatus.style.borderBottom = opts.borderBottom || "";
  activeConnectionStatus.style.backgroundColor = opts.bgColor || "";
  endTrigger.textContent = opts.endTriggerText || "";
  endTrigger.style.display = opts.endTriggerDisplay || "none";
}

// Cleans up any in-progress offer/answer attempts without killing an existing connection
function abortPendingConnection() {
  clearTimeout(connectionWaitTimer);
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
  } else {
    activeConnectionContainer.style.display = "none";
    endTrigger.style.display = "none";
  }
}

// Closes the current connection completely
function fullyResetConnection() {
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify({ type: "disconnect" }));
  }
  clearTimeout(connectionWaitTimer);
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
  fileTransferSection.style.display = "none";
  activeConnectionContainer.style.display = "none";
  activeConnectionStatus.textContent = "None";
  endTrigger.style.display = "none";
  abortPendingConnection();
}

// Assigns the self socket ID once connected
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

// Handles an offer from another peer
socket.on("offer", async (data) => {
  abortPendingConnection();
  if (peerConnection) {
    fullyResetConnection();
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
      borderBottom: "2px solid #27ae60",
      endTriggerText: "Disconnect",
      endTriggerDisplay: "inline-block",
    });
    setTimeout(() => {
      activeConnectionStatus.style.borderBottom = "";
    }, 2000);
    socket.emit("answer", {
      target: data.caller,
      sdp: peerConnection.localDescription,
    });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
});

// Handles an answer to our offer
socket.on("answer", async (data) => {
  try {
    await pendingPeerConnection.setRemoteDescription(data.sdp);
    peerConnection = pendingPeerConnection;
    dataChannel = pendingDataChannel;
    pendingPeerConnection = null;
    pendingDataChannel = null;
    activePeerId = data.callee;
    clearTimeout(newConnTimer);
    updateConnectionUI({
      containerDisplay: "flex",
      gap: "10px",
      labelText: "Connected to:",
      statusText: `${activePeerId}`,
      borderBottom: "2px solid #27ae60",
      endTriggerText: "Disconnect",
      endTriggerDisplay: "inline-block",
    });
    setTimeout(() => {
      activeConnectionStatus.style.borderBottom = "";
    }, 2000);
  } catch (err) {
    console.error("Error applying remote description:", err);
  }
});

// Receives ICE candidates from a peer
socket.on("candidate", (data) => {
  const targetConnection = pendingPeerConnection || peerConnection;
  if (targetConnection) {
    targetConnection
      .addIceCandidate(data.candidate)
      .catch((e) => console.error(e));
  }
});

// Prepares shared event listeners and data channels
function configureConnection(conn, targetId, isInitiator) {
  conn.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit("candidate", { target: targetId, candidate: evt.candidate });
    }
  };
  conn.ondatachannel = (evt) => {
    initializeDataChannel(evt.channel);
    if (isInitiator) {
      pendingDataChannel = evt.channel;
    } else {
      dataChannel = evt.channel;
    }
  };
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected") {
      clearTimeout(connectionWaitTimer);
      fileTransferSection.style.display = "block";
      endTrigger.style.display = "inline-block";
      endTrigger.textContent = "Disconnect";
    } else if (["disconnected", "failed"].includes(conn.connectionState)) {
      if (conn === pendingPeerConnection) {
        abortPendingConnection();
      } else if (conn === peerConnection) {
        fullyResetConnection();
      }
    }
  };
  if (isInitiator) {
    pendingDataChannel = conn.createDataChannel("fileChannel");
    initializeDataChannel(pendingDataChannel);
  }
}

// Sets up the data channel to handle file chunks or control messages
function initializeDataChannel(channel) {
  channel.binaryType = "arraybuffer";
  channel.onmessage = (evt) => {
    if (typeof evt.data === "string") {
      try {
        const message = JSON.parse(evt.data);
        if (message.type === "disconnect") {
          fullyResetConnection();
          return;
        }
      } catch (e) {
        // If JSON parse fails, it might be another type of text
      }
      processControlInstruction(evt.data);
    } else {
      processIncomingChunk(evt.data);
    }
  };
}

// When user types a potential partner ID, enable connect button if valid
partnerIdField.addEventListener("input", () => {
  connectTrigger.disabled = partnerIdField.value.trim() === "";
});

// Initiate a connection attempt
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
  connectionWaitTimer = setTimeout(() => {
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

// Ends an ongoing or pending connection
endTrigger.addEventListener("click", () => {
  resetIdMessage();
  if (pendingPeerConnection) {
    abortPendingConnection();
  } else {
    fullyResetConnection();
  }
});

// Make sure we clean up on page unload
window.addEventListener("beforeunload", () => {
  if (activePeerId) {
    fullyResetConnection();
  }
});
