let connectedPeerId = null;

// connection to signaling server
const socket = io();

const CHUNK_SIZE = 16 * 1024;

let peerConnection;
let dataChannel;
let myId = null;

// STUN server
const config = {
  iceServers: [{ urls: "stun:stun.stunprotocol.org" }],
};

// store and display socket ID
socket.on("connect", () => {
  myId = socket.id;
  document.getElementById("myId").textContent = myId;
});

// WebRTC offer
socket.on("offer", async (data) => {
  peerConnection = createPeerConnection(data.caller, false);
  connectedPeerId = data.caller;
  document.getElementById("connectedPeerId").textContent = connectedPeerId;

  try {
    await peerConnection.setRemoteDescription(data.sdp);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("answer", {
      target: data.caller,
      sdp: peerConnection.localDescription,
    });
  } catch (err) {
    console.error("Error handling offer:", err);
  }
});

// WebRTC answer
socket.on("answer", async (data) => {
  try {
    await peerConnection.setRemoteDescription(data.sdp);
    connectedPeerId = data.callee;
    document.getElementById("connectedPeerId").textContent = connectedPeerId;
  } catch (err) {
    console.error("Error setting remote description:", err);
  }
});

// ICE candidates
socket.on("candidate", (data) => {
  peerConnection.addIceCandidate(data.candidate).catch((e) => console.error(e));
});

// connect to peer
document.getElementById("connectBtn").addEventListener("click", () => {
  const peerId = document.getElementById("peerId").value.trim();
  if (!peerId || !/^[a-zA-Z0-9_-]+$/.test(peerId)) {
    alert("Invalid peer ID!");
    return;
  }

  peerConnection = createPeerConnection(peerId, true);

  peerConnection
    .createOffer()
    .then((offer) => peerConnection.setLocalDescription(offer))
    .then(() => {
      socket.emit("offer", {
        target: peerId,
        sdp: peerConnection.localDescription,
      });
    })
    .catch((err) => console.error("Error creating offer:", err));
});

// send file
document.getElementById("sendFileBtn").addEventListener("click", () => {
  if (!dataChannel || dataChannel.readyState !== "open") {
    alert("Data channel not open!");
    return;
  }

  const file = document.getElementById("fileInput").files[0];
  if (!file) {
    alert("No file selected!");
    return;
  }

  const metadata = {
    type: "metadata",
    fileName: file.name,
    fileSize: file.size,
  };

  dataChannel.send(JSON.stringify(metadata));
  sendFileInChunks(file);
});

// create WebRTC peer connection
function createPeerConnection(targetId, isOfferer = false) {
  const pc = new RTCPeerConnection(config);

  if (isOfferer) {
    dataChannel = pc.createDataChannel("fileChannel");
    setupDataChannel(dataChannel);
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", {
        target: targetId,
        candidate: event.candidate,
      });
    }
  };

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel(dataChannel);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      document.getElementById("fileSection").style.display = "block";
    }
  };

  return pc;
}
