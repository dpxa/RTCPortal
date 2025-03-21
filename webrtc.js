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

let idMsgTimer = null;
let newConnTimer = null;
let newIdAlertTimer = null;

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

// encapsulates all changes to UI
const uiManager = {
  // change message box above id
  showCopied() {
    clearTimeout(idMsgTimer);
    statusIdMessage.textContent = "Copied";
    statusIdMessage.style.display = "inline-block";
    statusIdMessage.style.border = "1px solid #ccc";
    statusIdMessage.style.color = "black";
    statusIdMessage.style.padding = "2px 4px";
    statusIdMessage.style.fontSize = "0.8rem";
    idMsgTimer = setTimeout(() => this.clearAlert(), 4000);
  },
  showIdError(msg) {
    clearTimeout(idMsgTimer);
    statusIdMessage.textContent = msg;
    statusIdMessage.style.display = "inline-block";
    statusIdMessage.style.border = "1.5px solid red";
    statusIdMessage.style.color = "red";
    statusIdMessage.style.padding = "1px 2px";
    statusIdMessage.style.fontSize = "0.7rem";
    idMsgTimer = setTimeout(() => uiManager.clearAlert(), 4000);
  },
  clearAlert() {
    clearTimeout(idMsgTimer);
    statusIdMessage.textContent = "";
    statusIdMessage.style.display = "none";
    statusIdMessage.style.border = "";
    statusIdMessage.style.color = "";
    statusIdMessage.style.padding = "";
    statusIdMessage.style.fontSize = "";
  },

  // no current connection
  updateToIdle() {
    fileTransferUI.clearAlert();
    uploadField.value = "";
    fileTransferTrigger.disabled = true;
    activeConnectionContainer.style.display = "none";
    activeConnectionStatus.textContent = "";
    endTrigger.style.display = "none";
    fileTransferSection.style.display = "none";
  },
  // waiting for connection
  // always called before new conenction is established on initiators end
  updateToWaiting() {
    activeConnectionContainer.style.display = "flex";
    activeConnectionLabel.textContent = "Waiting for peer...";
    activeConnectionStatus.textContent = "";
    activeConnectionStatus.style.textDecoration = "";
    activeConnectionStatus.style.textDecorationColor = "";
    activeConnectionStatus.style.textDecorationThickness = "";
    endTrigger.textContent = "Cancel";
    endTrigger.style.display = "inline-block";
  },
  updateToConnectedAfterAbort(peerId) {
    activeConnectionContainer.style.display = "flex";
    activeConnectionLabel.textContent = "Connected to:";
    activeConnectionStatus.textContent = peerId;
    endTrigger.textContent = "Disconnect";
    endTrigger.style.display = "inline-block";
    fileTransferSection.style.display = "block";
  },
  updateToConnected(peerId) {
    clearTimeout(newIdAlertTimer);
    uploadField.value = "";
    fileTransferTrigger.disabled = true;
    activeConnectionContainer.style.display = "flex";
    activeConnectionLabel.textContent = "Connected to:";
    activeConnectionStatus.textContent = peerId;
    activeConnectionStatus.style.textDecoration = "underline";
    activeConnectionStatus.style.textDecorationColor = "#27ae60";
    activeConnectionStatus.style.textDecorationThickness = "3px";
    endTrigger.textContent = "Disconnect";
    endTrigger.style.display = "inline-block";
    fileTransferSection.style.display = "block";
    // briefly underline peer id on connection
    newIdAlertTimer = setTimeout(() => {
      activeConnectionStatus.style.textDecoration = "";
      activeConnectionStatus.style.textDecorationColor = "";
      activeConnectionStatus.style.textDecorationThickness = "";
    }, 4000);
  },
};

// when user connects, save their id
socket.on("connect", () => {
  selfId = socket.id;
  myIdDisplay.textContent = selfId;
});

// copy user's id
copyIdTrigger.addEventListener("click", () => {
  navigator.clipboard
    .writeText(selfId)
    .then(() => uiManager.showCopied())
    .catch((error) => console.error("Error copying ID:", error));
});

partnerIdField.addEventListener("input", () => {
  connectTrigger.disabled = partnerIdField.value.trim() === "";
});

// if there is a pending connection ("waiting"), end it
// cancel was pressed
function abortPendingConnection() {
  uiManager.clearAlert();
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
    uiManager.updateToConnectedAfterAbort(activePeerId);
  }
}

function resetCurrentConnection(resetUI = true) {
  uiManager.clearAlert();
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
  console.log(1);
  if (resetUI) {
    uiManager.updateToIdle();
  }
}

connectTrigger.addEventListener("click", async () => {
  const peerId = partnerIdField.value.trim();
  partnerIdField.value = "";
  connectTrigger.disabled = true;

  // basic handling
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

  // this user will have brief waiting screen
  uiManager.clearAlert();
  abortPendingConnection();
  uiManager.updateToWaiting();
  newConnTimer = setTimeout(() => {
    uiManager.showIdError("Connection timed out.");
    abortPendingConnection();
  }, 30000);

  pendingPeerConnection = new RTCPeerConnection(rtcConfig);
  configureConnection(pendingPeerConnection, peerId, true);

  try {
    // set local SDP answer
    const offer = await pendingPeerConnection.createOffer();
    await pendingPeerConnection.setLocalDescription(offer);

    socket.emit("offer", {
      target: peerId,
      sdp: pendingPeerConnection.localDescription,
    });
  } catch (err) {
    console.error("Error creating offer:", err);
  }
});

socket.on("offer", async (data) => {
  uiManager.clearAlert();
  abortPendingConnection();
  if (peerConnection) {
    resetCurrentConnection(false);
    uploadField.value = "";
    fileTransferTrigger.disabled = true;
  }

  peerConnection = new RTCPeerConnection(rtcConfig);
  configureConnection(peerConnection, data.caller, false);

  try {
    // set received SDP answer
    await peerConnection.setRemoteDescription(data.sdp);
    // set local SDP answer
    const ans = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(ans);
    activePeerId = data.caller;
    
    // send the answer to the caller
    socket.emit("answer", {
      target: data.caller,
      sdp: peerConnection.localDescription,
    });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
});

socket.on("answer", async (data) => {
  if (activePeerId) {
    resetCurrentConnection();
  }
  try {
    // set received SDP answer
    await pendingPeerConnection.setRemoteDescription(data.sdp);
    activePeerId = data.callee;

    // pending connection was successful, so set it as current connection
    peerConnection = pendingPeerConnection;
    dataChannel = pendingDataChannel;
    pendingPeerConnection = null;
    pendingDataChannel = null;
  } catch (err) {
    console.error("Error applying remote description:", err);
  }
});

socket.on("candidate", (data) => {
  // if pending connection exists, that connection should receive the candidate
  const targetConnection = pendingPeerConnection || peerConnection;
  if (targetConnection) {
    targetConnection
      .addIceCandidate(data.candidate)
      .catch((e) => console.error(e));
  }
});

function configureConnection(conn, targetId, isInitiator) {
  // event handler as ICE candiates become avaliable
  conn.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit("candidate", { target: targetId, candidate: evt.candidate });
    }
  };
  // only the initiator creates the data channel
  conn.ondatachannel = (evt) => {
    const channel = evt.channel;
    initializeDataChannel(channel);
    if (!isInitiator) {
      dataChannel = channel;
    }
  };
  conn.onconnectionstatechange = () => {
    if (conn.connectionState === "connected") {
      // end pending connection timeout and change UI
      clearTimeout(newConnTimer);
      uiManager.updateToConnected(activePeerId);
    } else if (["disconnected", "failed"].includes(conn.connectionState)) {
      resetCurrentConnection();
    }
  };
  if (isInitiator) {
    pendingDataChannel = conn.createDataChannel("fileChannel");
    initializeDataChannel(pendingDataChannel);
  }
}

// handle all non file messages
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

// doubles as cancel button if pending connection exists
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

// close all possible connections on tab close
window.addEventListener("beforeunload", () => {
  if (activePeerId) {
    resetCurrentConnection();
    abortPendingConnection();
  }
});
