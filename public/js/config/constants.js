const PROD_API_URL = "https://rtcportal.onrender.com";
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"];
const environmentIsProd = !LOCAL_HOSTNAMES.includes(window.location.hostname);

const BASE_API_URL = environmentIsProd ? PROD_API_URL : "";

const API_ENDPOINTS = {
  TURN_CREDENTIALS: "/api/turn-credentials",
  CONNECTION_STATS: "/api/connection-stats",
};

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
  iceCandidatePoolSize: 2,
  sdpSemantics: "unified-plan",
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

const SLICE_SIZE = 262144;
const DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD = 1048576;
const DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT = 4194304;

const CONNECTION_TIMEOUT = 30000;
const TRANSFER_CLEANUP_DELAY = 600;
const TRANSFER_PAUSE_POLL_INTERVAL = 200;
const CONNECTION_RESET_DELAY = 4000;
const CONNECTION_RECOVERY_DELAY = 30000;
const DOWNLOAD_BLOB_URL_REVOKE_DELAY = 100;
const ALERT_TIMEOUT = 4000;
const WARNING_TIMEOUT = ALERT_TIMEOUT + 2000;
const ID_UNDERLINE_TIMEOUT = 4000;
const STATS_FETCH_INTERVAL = 30000;

const SOCKET_TRANSPORTS = ["websocket", "polling"];

function getCssVar(name, fallback = "") {
  try {
    const root = getComputedStyle(document.documentElement);
    return (root.getPropertyValue(name) || fallback).trim();
  } catch (error) {
    return fallback;
  }
}
