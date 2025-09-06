const BASE_API_URL = environmentIsProd ? "https://rtcportal.onrender.com" : "";

// WebRTC Configuration
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.sipgate.net:3478" },
    { urls: "stun:stun.ekiga.net:3478" },
    { urls: "stun:stun.ideasip.com:3478" },
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

// File transfer settings
const SLICE_SIZE = 16384;

// Timeouts (in milliseconds)
const CONNECTION_TIMEOUT = 30000;
const ALERT_TIMEOUT = 4000;
const ID_UNDERLINE_TIMEOUT = 4000;
const STATS_FETCH_INTERVAL = 30000;

const SOCKET_IO_TRANSPORTS = ["websocket", "polling"];
