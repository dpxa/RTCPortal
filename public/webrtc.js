const socket = io();

let connectedPeerId = null;

let peerConnection;
let dataChannel;
let myId = null;

// ice server config with stun
const config = {
  iceServers: [{ urls: "stun:stun.stunprotocol.org" }],
};

// user's id is socket.id
socket.on("connect", () => {
  myId = socket.id;
  document.getElementById("myId").textContent = myId;
});


// recieved when another peer wants to start a WebRTC connection
socket.on("offer", async (data) => {
  peerConnection = createPeerConnection(data.caller, false);

  // peer id that sent the offer
  connectedPeerId = data.caller;
  document.getElementById("connectedPeerId").textContent = connectedPeerId;

  try {
    // set remote description to incoming offer SDP
    await peerConnection.setRemoteDescription(data.sdp);
    // create our own answer and set
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // send answer back to the caller
    socket.emit("answer", {
      target: data.caller,
      sdp: peerConnection.localDescription,
    });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
});

// recieved after we send an offer and the other peer responds with their answer
socket.on("answer", async (data) => {
  try {
    // set remote description to incoming offer SDP
    await peerConnection.setRemoteDescription(data.sdp);

    // peer id that sent the answer
    connectedPeerId = data.callee;
    document.getElementById("connectedPeerId").textContent = connectedPeerId;
  } catch (err) {
    console.error("Error setting remote description:", err);
  }
});

// recieves ICE candidates that other peer discovered
socket.on("candidate", (data) => {
  peerConnection.addIceCandidate(data.candidate).catch((e) => console.error(e));
});

// user inputs peer id they want to connect to, and an offer is created
document.getElementById("connectBtn").addEventListener("click", () => {
  const peerId = document.getElementById("peerId").value.trim();

  // validation of peer id
  if (!peerId || !/^[a-zA-Z0-9_-]+$/.test(peerId)) {
    alert("Invalid peer ID!");
    return;
  }

  peerConnection = createPeerConnection(peerId, true);

  // create a sdp offer
  peerConnection
    .createOffer()
    .then((offer) => peerConnection.setLocalDescription(offer))
    .then(() => {
      // send offer to signaling server so it can be relayed to recipient
      socket.emit("offer", {
        target: peerId,
        sdp: peerConnection.localDescription,
      });
    })
    .catch((err) => console.error("Error creating offer:", err));
});

// user selects a file and sends it
document.getElementById("sendFileBtn").addEventListener("click", () => {
  // data channel must be open
  if (!dataChannel || dataChannel.readyState !== "open") {
    alert("Data channel not open!");
    return;
  }

  const file = document.getElementById("fileInput").files[0];
  if (!file) {
    alert("No file selected!");
    return;
  }

  // before sending file, send file metadata
  const metadata = {
    type: "metadata",
    fileName: file.name,
    fileSize: file.size,
  };
  dataChannel.send(JSON.stringify(metadata));

  sendFileInChunks(file);
});

// creates a RTCPeerConnection, data channel, and ICE candidate handling
function createPeerConnection(targetId, isOfferer = false) {
  const pc = new RTCPeerConnection(config);

  // if we are creating the offer, also create the data channel
  if (isOfferer) {
    dataChannel = pc.createDataChannel("fileChannel");
    setupDataChannel(dataChannel);
  }

  // when the browser finds an ICE candidate
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      // send candidate to signaling server so it can be relayed to recipient
      socket.emit("candidate", {
        target: targetId,
        candidate: event.candidate,
      });
    }
  };

  // when offering peer creates a data channel (ran on peer that answered)
  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  };

  // when a connection is established (other state logic is WIP)
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      document.getElementById("fileSection").style.display = "block";
    }
  };

  return pc;
}
