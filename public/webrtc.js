const socket = isProduction
  ? io("https://rtcportal.onrender.com", {
      transports: ["websocket", "polling"],
    })
  : io();

// HTML objects for WebRTC
const myIdSpan = document.getElementById("myId");
const copyMyIdBtn = document.getElementById("copyMyId");
const msgIdSpan = document.getElementById("msgId");
const peerIdInput = document.getElementById("peerId");
const connectionStatusContainer = document.getElementById("connectionStatusContainer");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const connectedToLabel = document.getElementById("connectedToLabel");
const connectionStatus = document.getElementById("connectionStatus");
const fileSection = document.getElementById("fileSection");

messageCopyTimeout = null;
messageIdTimeout = null;

function copyMessage() {
  clearTimeout(messageCopyTimeout);
  clearTimeout(messageIdTimeout);
  messageIdTimeout = null;
  msgIdSpan.textContent = "Copied";
  msgIdSpan.style.display = "inline-block";
  msgIdSpan.style.border = "";
  msgIdSpan.style.color = "black";
  msgIdSpan.style.padding = "";
  msgIdSpan.style.fontSize = "0.8rem";

  messageCopyTimeout = setTimeout(() => {
    msgIdSpan.textContent = "";
    msgIdSpan.style.display = "none";
    msgIdSpan.style.color = "";
    msgIdSpan.style.fontSize = "";
  }, 4000);
}

function showIdError(message) {
  clearTimeout(messageCopyTimeout);
  clearTimeout(messageIdTimeout);
  messageIdTimeout = null;
  msgIdSpan.textContent = message;
  msgIdSpan.style.display = "inline-block";
  msgIdSpan.style.border = `1.5px solid red`;
  msgIdSpan.style.color = "red";
  msgIdSpan.style.padding = "1px 2px";
  msgIdSpan.style.fontSize = "0.7rem";

  messageIdTimeout = setTimeout(() => {
    msgIdSpan.textContent = "";
    msgIdSpan.style.display = "none";
    msgIdSpan.style.border = "";
    msgIdSpan.style.color = "";
    msgIdSpan.style.padding = "";
    msgIdSpan.style.fontSize = "";
  }, 4000);
}

function resetIdMessage() {
  if (messageIdTimeout) {
    clearTimeout(messageIdTimeout);
    messageIdTimeout = null;
    msgIdSpan.textContent = "";
    msgIdSpan.style.display = "none";
    msgIdSpan.style.border = "";
    msgIdSpan.style.color = "";
    msgIdSpan.style.padding = "";
    msgIdSpan.style.fontSize = "";
  }
}

let connectedPeerId = null;
let peerConnection = null;
let dataChannel = null;
let myId = null;
// ice server config
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
};

let connectionTimeout = null;
let newConnectionTimeout = null;

function resetConnection(newConnection = false) {
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify({ type: "disconnect" }));
  }
  clearTimeout(connectionTimeout);
  clearTimeout(newConnectionTimeout);
  clearTimeout(messageFileTimeout);

  // reset webRTC
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
  connectedPeerId = null;

  // reset file input for if other peer ends connection via exiting tab
  fileInput.value = "";
  resetProgressBar();
  sendFileBtn.disabled = true;

  if (!newConnection) {
    // reset UI
    connectionStatusContainer.style.display = "none";
    fileSection.style.display = "none";
    connectionStatus.textContent = "None";
    disconnectBtn.style.display = "none";
  }

}

// when client connects to the server
socket.on("connect", () => {
  // save/display our id
  myId = socket.id;
  myIdSpan.textContent = myId;

  // event listener for copy button
  copyMyIdBtn.addEventListener("click", () => {
    navigator.clipboard
      .writeText(myId)
      .then(copyMessage())
      .catch((err) => console.error("Error copying ID:", err));
  });
});

// when user gets offer from a peer
socket.on("offer", async (data) => {
  // if the user has an active connection, end it
  if (peerConnection) {
    resetConnection(true);
  }

  peerConnection = createPeerConnection(data.caller, false); // create peer connection as callee

  try {
    await peerConnection.setRemoteDescription(data.sdp); // set remote description from offer
    const answer = await peerConnection.createAnswer(); // create an answer to the offer
    await peerConnection.setLocalDescription(answer); // set local description with the answer

    // save/display caller's id
    connectedPeerId = data.caller;
    clearTimeout(newConnectionTimeout);
    connectionStatusContainer.style.display = "flex";
    connectionStatusContainer.style.gap = "10px";
    connectedToLabel.textContent = "Connected to:";
    connectionStatus.textContent = `${connectedPeerId}`;
    connectionStatus.style.borderBottom = "2px solid #4a90e2";
    newConnectionTimeout = setTimeout(() => {
      connectionStatus.style.borderBottom = "";
    }, 2000);

    // send the answer to the caller
    socket.emit("answer", {
      target: data.caller,
      sdp: peerConnection.localDescription,
    });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
});

// when user gets answer from a peer
socket.on("answer", async (data) => {
  try {
    await peerConnection.setRemoteDescription(data.sdp); // set remote description from answer

    // save/display callee's id
    connectedPeerId = data.callee;
    clearTimeout(newConnectionTimeout);
    connectionStatusContainer.style.display = "flex";
    connectionStatusContainer.style.gap = "10px";
    connectionStatus.style.borderBottom = "2px solid #4a90e2";
    connectedToLabel.textContent = "Connected to:";
    connectionStatus.textContent = `${connectedPeerId}`;
    setTimeout(() => {
      connectionStatus.style.borderBottom = "";
    }, 2000);
  } catch (err) {
    console.error("Error setting remote description:", err);
  }
});

// when user gets ICE candidate from a peer
socket.on("candidate", (data) => {
  peerConnection.addIceCandidate(data.candidate).catch((e) => console.error(e));
});

function createPeerConnection(targetId, isOfferer = false) {
  // new peer connection with ICE servers
  const pc = new RTCPeerConnection(config);

  // if we are the offerer, create a data channel
  if (isOfferer) {
    dataChannel = pc.createDataChannel("fileChannel");
    setupDataChannel(dataChannel);
  }

  // send ICE candidate to the peer
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", {
        target: targetId,
        candidate: event.candidate,
      });
    }
  };

  // when data channel is received
  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  };

  // monitor connection state to update UI accordingly
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      clearTimeout(connectionTimeout);
      fileSection.style.display = "block";
      disconnectBtn.style.display = "inline-block";
    } else if (["disconnected", "failed"].includes(pc.connectionState)) {
      resetConnection();
    }
  };

  // return configured peer connection
  return pc;
}

function setupDataChannel(channel) {
  // set binary type to arraybuffer for file chunks
  channel.binaryType = "arraybuffer";
  channel.onmessage = (event) => {
    if (typeof event.data === "string") {
      const message = JSON.parse(event.data);
      if (message.type === "disconnect") {
        resetConnection();
        return;
      } else {
        handleControlMessage(event.data);
        return;
      }
    } else {
      handleFileChunk(event.data);
    }
  };
}

peerIdInput.addEventListener("input", () => {
  connectBtn.disabled = peerIdInput.value.trim() === "";
});

connectBtn.addEventListener("click", () => {
  // get and trim peer ID
  const peerId = peerIdInput.value.trim();
  peerIdInput.value = "";
  connectBtn.disabled = true;

  // validate peer ID
  if (!/^[a-zA-Z0-9_-]+$/.test(peerId)) {
    showIdError("Invalid peer ID!");
    return;
  }
  if (peerId === myId) {
    showIdError("Invalid peer ID! Cannot connect to yourself.");
    return;
  }
  if (peerId === connectedPeerId) {
    showIdError("Already connected to this peer.");
    return;
  }
  resetIdMessage();

  // if the user has an active connection, end it
  if (peerConnection) {
    resetConnection(true);
  }

  clearTimeout(newConnectionTimeout);
  if (connectedPeerId) {
    connectionStatus.style.borderBottom = "";
  }
  connectionStatusContainer.style.display = "flex";
  connectionStatusContainer.style.gap = 0;
  connectedToLabel.textContent = "";
  connectionStatus.textContent = "Waiting for peer...";
  // reset attempt to connect if it takes too long
  connectionTimeout = setTimeout(() => {
    showIdError("Connection timed out. Peer is not available.");
    if (!connectedPeerId) {
      connectionStatusContainer.style.display = "none";
    } else {
      connectedToLabel.textContent = "Connected to:";
      connectionStatus.textContent = `${connectedPeerId}`;
    }
  }, 15000);

  peerConnection = createPeerConnection(peerId, true); // create peer connection as caller
  peerConnection
    .createOffer() // create an offer
    .then((offer) => peerConnection.setLocalDescription(offer)) // Set local description with the offer
    .then(() => {
      // send the offer to the callee
      socket.emit("offer", {
        target: peerId,
        sdp: peerConnection.localDescription,
      });
    })
    .catch((err) => console.error("Error creating offer:", err));
});

disconnectBtn.addEventListener("click", () => {
  resetIdMessage();
  resetConnection();
});

window.addEventListener("beforeunload", () => {
  if (connectedPeerId) {
    resetConnection();
  }
});
