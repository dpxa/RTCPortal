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
  // Load constants.js first and wait for it to finish loading
  const constantsScript = document.createElement("script");
  constantsScript.src = "js/config/constants.js";
  constantsScript.onload = function () {
    // Now load the rest of the scripts
    const scripts = [
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
  document.body.appendChild(constantsScript);
};

document.head.appendChild(socketScript);
