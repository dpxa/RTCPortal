// load main scripts in separate script
// this way I am able to use local scripts to test
const environmentIsProd = window.location.hostname !== "localhost";
const socketIoSrc = environmentIsProd
  ? "https://rtcportal.onrender.com/socket.io/socket.io.js"
  : "socket.io/socket.io.js";

const socketScript = document.createElement("script");
socketScript.src = socketIoSrc;
socketScript.onload = function () {
  ["fileTransfer.js", "webrtc.js"].forEach((fileName) => {
    const tempScript = document.createElement("script");
    tempScript.src = fileName;
    document.body.appendChild(tempScript);
  });
};

document.head.appendChild(socketScript);
