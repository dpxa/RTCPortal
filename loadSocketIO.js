// load main scripts dynamically
const isProduction = window.location.hostname !== "localhost";
const scriptSrc = isProduction
  ? "https://rtcportal.onrender.com/socket.io/socket.io.js"
  : "socket.io/socket.io.js";

const socketIoScript = document.createElement("script");
socketIoScript.src = scriptSrc;
socketIoScript.onload = function () {
  ["webrtc.js", "fileTransfer.js"].forEach((src) => {
    const s = document.createElement("script");
    s.src = src;
    document.body.appendChild(s);
  });
};

document.head.appendChild(socketIoScript);
