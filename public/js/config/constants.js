export const PROD_API_URL = "https://rtcportal.onrender.com";
export const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"];
export const _isLocalNetwork = (hostname) =>
  !hostname ||
  LOCAL_HOSTNAMES.includes(hostname) ||
  hostname === "::1" ||
  hostname.startsWith("fe80:") ||
  hostname.startsWith("fc00:") ||
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname);
export const environmentIsProd = !_isLocalNetwork(window.location.hostname);

export const BASE_API_URL = environmentIsProd ? PROD_API_URL : "";

export const API_ENDPOINTS = {
  TURN_TOKEN: "/api/turn-token",
  TURN_CREDENTIALS: "/api/turn-credentials",
  CONNECTION_STATS: "/api/connection-stats",
};

export const RTC_CONFIG = {
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

export const SLICE_SIZE = 65536;
export const DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD = 1048576;
export const DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT = 4194304;
export const DATA_CHANNEL_BUFFER_MAX_RETRIES = 1200;
export const DATA_CHANNEL_BUFFER_RETRY_INTERVAL_MS = 50;
export const RECEIVE_BUFFER_THROTTLE_THRESHOLD = 10485760;
export const RECEIVE_BUFFER_RESUME_THRESHOLD = 2097152;
export const DEFAULT_SEND_RATE_LIMIT_BYTES_PER_SEC = 0;
export const MAX_RECEIVE_BATCH_SIZE = 2 * 1024 * 1024 * 1024;

export const CONNECTION_TIMEOUT = 30000;
export const CONNECTION_RECOVERY_DELAY = 12000;
export const HEARTBEAT_INTERVAL = 15000;
export const TRANSFER_CLEANUP_DELAY = 600;
export const TRANSFER_PAUSE_POLL_INTERVAL = 200;
export const CONNECTION_RESET_DELAY = 4000;
export const DOWNLOAD_BLOB_URL_REVOKE_DELAY = 30000;
export const ALERT_TIMEOUT = 4000;
export const WARNING_TIMEOUT = ALERT_TIMEOUT + 2000;
export const ID_UNDERLINE_TIMEOUT = 4000;
export const STATS_FETCH_INTERVAL = 30000;
export const UI_UPDATE_INTERVAL = 100;

export const SOCKET_TRANSPORTS = ["websocket", "polling"];
//