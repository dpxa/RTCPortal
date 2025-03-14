const socket = io();

// HTML objects for WebRTC
const myIdSpan = document.getElementById("myId");
const copyMyIdBtn = document.getElementById("copyMyId");
const copyStatusSpan = document.getElementById("copyStatus");
const peerIdInput = document.getElementById("peerId");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const connectionStatus = document.getElementById("connectionStatus");
const fileSection = document.getElementById("fileSection");

let connectedPeerId = null;
let peerConnection;
let dataChannel;
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

let heartbeatInterval;
let heartbeatTimeout;
let lastHeartbeatReceived = Date.now();

function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    if (dataChannel && dataChannel.readyState === "open") {
      dataChannel.send(
        JSON.stringify({ type: "heartbeat", timestamp: Date.now() })
      );
    }
  }, 500);

  heartbeatTimeout = setInterval(() => {
    if (Date.now() - lastHeartbeatReceived > 1500) {
      console.warn("Heartbeat timeout, disconnecting...");
      resetConnection();
    }
  }, 750);
}

function stopHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (heartbeatTimeout) clearInterval(heartbeatTimeout);
}

function resetConnection() {
  // reset webRTC
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  stopHeartbeat();
  connectedPeerId = null;

  // reset UI
  fileSection.style.display = "none";
  connectionStatus.textContent = "Connected to: None";
  disconnectBtn.style.display = "none";

  // reset file input for if other peer ends connection via exiting tab
  fileInputFT.value = "";
  resetProgressBar();
  sendFileBtnFT.disabled = false;
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
      .then(() => {
        copyStatusSpan.textContent = "Copied";
        setTimeout(() => {
          copyStatusSpan.textContent = "";
        }, 2000);
      })
      .catch((err) => console.error("Error copying ID:", err));
  });
});

// when user gets offer from a peer
socket.on("offer", async (data) => {
  // if the user has an active connection, end it
  if (peerConnection) {
    resetConnection();
  }

  peerConnection = createPeerConnection(data.caller, false); // create peer connection as callee

  try {
    await peerConnection.setRemoteDescription(data.sdp);  // set remote description from offer
    const answer = await peerConnection.createAnswer();   // create an answer to the offer
    await peerConnection.setLocalDescription(answer);     // set local description with the answer

    // save/display caller's id
    connectedPeerId = data.caller;
    connectionStatus.textContent = `Connected to: ${connectedPeerId}`;

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
    await peerConnection.setRemoteDescription(data.sdp);  // set remote description from answer

    // save/display callee's id
    connectedPeerId = data.callee;
    connectionStatus.textContent = `Connected to: ${connectedPeerId}`;
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

  // reset attempt to connect if it takes too long
  const connectionTimeout = setTimeout(() => {
    alert("Connection timed out. Peer is not available.");
    resetConnection();
  }, 10000);

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
      lastHeartbeatReceived = Date.now();
      startHeartbeat();
    } else if (["disconnected", "failed"].includes(pc.connectionState)) {
      clearTimeout(connectionTimeout);
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
        if (message.type === "heartbeat") {
          lastHeartbeatReceived = Date.now();
          return;
        }
        // metadata, done
        handleControlMessage(event.data);
    } else {
      handleFileChunk(event.data);
    }
  };
}

connectBtn.addEventListener("click", () => {
  // get and trim peer ID
  const peerId = peerIdInput.value.trim();
  peerIdInput.value = "";

  // validate peer ID
  if (!peerId || !/^[a-zA-Z0-9_-]+$/.test(peerId)) {
    alert("Invalid peer ID!");
    return;
  }
  if (peerId === myId) {
    alert("Invalid peer ID! Cannot connect to yourself.");
    return;
  }

  // if the user has an active connection, end it
  if (peerConnection) {
    resetConnection();
  }

  connectionStatus.textContent = "Waiting for peer...";
  peerConnection = createPeerConnection(peerId, true);            // create peer connection as caller
  peerConnection
    .createOffer()                                                // create an offer
    .then((offer) => peerConnection.setLocalDescription(offer))   // Set local description with the offer
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
  resetConnection();
  disconnectBtn.style.display = "none";
});
