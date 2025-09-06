// load main scripts in separate script
// this way I am able to use local scripts to test
const environmentIsProd =
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1";
const socketIoSrc = environmentIsProd
  ? "https://rtcportal.onrender.com/socket.io/socket.io.js"
  : "socket.io/socket.io.js";

const socketScript = document.createElement("script");
socketScript.src = socketIoSrc;
socketScript.onload = function () {
  const scripts = [
    "js/config/constants.js",
    "js/ui/uiManager.js",
    "js/services/turnService.js",
    "js/services/statsService.js",
    "js/core/fileTransferManager.js",
    "js/core/webrtcManager.js"
  ];
  
  scripts.forEach((fileName) => {
    const tempScript = document.createElement("script");
    tempScript.src = fileName;
    document.body.appendChild(tempScript);
  });
};

document.head.appendChild(socketScript);
