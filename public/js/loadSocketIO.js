const socketIoSrc = `${BASE_API_URL}/socket.io/socket.io.js`;

const socketScript = document.createElement("script");
socketScript.src = socketIoSrc;
socketScript.onload = function () {
  const webrtcScript = document.createElement("script");
  webrtcScript.src = "js/core/webrtcManager.js";
  document.body.appendChild(webrtcScript);
};

document.head.appendChild(socketScript);
