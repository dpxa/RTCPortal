const PROD_API_URL = "https://rtcportal.onrender.com";
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"];
const environmentIsProd = !LOCAL_HOSTNAMES.includes(window.location.hostname);

const BASE_API_URL = environmentIsProd ? PROD_API_URL : "";

const API_ENDPOINTS = {
  TURN_TOKEN: "/api/turn-token",
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

const SLICE_SIZE = 65536;
const DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD = 1048576;
const DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT = 4194304;
const DATA_CHANNEL_BUFFER_MAX_RETRIES = 600;
const DATA_CHANNEL_BUFFER_RETRY_INTERVAL_MS = 50;
const RECEIVE_BUFFER_THROTTLE_THRESHOLD = 10485760;
const RECEIVE_BUFFER_RESUME_THRESHOLD = 2097152;
const DEFAULT_SEND_RATE_LIMIT_BYTES_PER_SEC = 0;
const MAX_RECEIVE_BATCH_SIZE = 2 * 1024 * 1024 * 1024;

const CONNECTION_TIMEOUT = 30000;
const CONNECTION_RECOVERY_DELAY = 12000;
const HEARTBEAT_INTERVAL = 15000;
const TRANSFER_CLEANUP_DELAY = 600;
const TRANSFER_PAUSE_POLL_INTERVAL = 200;
const CONNECTION_RESET_DELAY = 4000;
const DOWNLOAD_BLOB_URL_REVOKE_DELAY = 30000;
const ALERT_TIMEOUT = 4000;
const WARNING_TIMEOUT = ALERT_TIMEOUT + 2000;
const ID_UNDERLINE_TIMEOUT = 4000;
const STATS_FETCH_INTERVAL = 30000;
const UI_UPDATE_INTERVAL = 100;

const SOCKET_TRANSPORTS = ["websocket", "polling"];

function getCssVar(name, fallback = "") {
  try {
    const root = getComputedStyle(document.documentElement);
    return (root.getPropertyValue(name) || fallback).trim();
  } catch (error) {
    return fallback;
  }
}
