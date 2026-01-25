const PROD_API_URL = "https://rtcportal.onrender.com";

const environmentIsProd = !["localhost", "127.0.0.1"].includes(
  window.location.hostname,
);

const BASE_API_URL = environmentIsProd ? PROD_API_URL : "";

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
  iceCandidatePoolSize: 0,
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

const SLICE_SIZE = 16384;

const CONNECTION_TIMEOUT = 30000;
const ALERT_TIMEOUT = 4000;
const ID_UNDERLINE_TIMEOUT = 4000;
const STATS_FETCH_INTERVAL = 30000;

const SOCKET_IO_TRANSPORTS = ["websocket", "polling"];
