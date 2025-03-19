const environmentIsProd = window.location.hostname !== "localhost";
const socketIoSrc = environmentIsProd
  ? "https://rtcportal.onrender.com/socket.io/socket.io.js"
  : "socket.io/socket.io.js";

const socketScript = document.createElement("script");
socketScript.src = socketIoSrc;
socketScript.onload = function () {
  ["webrtc.js", "fileTransfer.js"].forEach((fileName) => {
    const tempScript = document.createElement("script");
    tempScript.src = fileName;
    document.body.appendChild(tempScript);
  });
};

document.head.appendChild(socketScript);
