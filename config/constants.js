const DEFAULT_PORT = 3000;

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOST: "0.0.0.0",

  ROUTES: {
    API: "/api",
  },

  CORS_ORIGINS: {
    GITHUB_PAGES: "https://dpxa.github.io",
    LOCALHOST: [
      `http://localhost:${DEFAULT_PORT}`,
      `http://127.0.0.1:${DEFAULT_PORT}`,
    ],
  },

  CSP_DIRECTIVES: {
    SCRIPT_SRC: [
      "'self'",
      "https://cdnjs.cloudflare.com",
      "https://cdn.jsdelivr.net",
    ],
    STYLE_SRC: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
    FONT_SRC: ["'self'", "https://fonts.gstatic.com"],
  },

  SOCKET_TRANSPORTS: ["websocket", "polling"],

  API_ENDPOINTS: {
    TURN_TOKEN: "/turn-token",
    TURN_CREDENTIALS: "/turn-credentials",
    CONNECTION_STATS: "/connection-stats",
  },

  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_API_REQUESTS_DEV: 1000,
    MAX_API_REQUESTS_PROD: 100,
    MAX_TURN_REQUESTS_DEV: 200,
    MAX_TURN_REQUESTS_PROD: 20,
    MAX_TURN_TOKEN_REQUESTS_DEV: 500,
    MAX_TURN_TOKEN_REQUESTS_PROD: 50,
    MESSAGES: {
      API_LIMIT: "Too many requests from this IP, please try again later.",
      TURN_LIMIT: "Too many TURN credential requests, please try again later.",
      TURN_TOKEN_LIMIT: "Too many TURN token requests, please try again later.",
    },
  },

  STATS_RATE_LIMIT: {
    maxRequests: 60,
    windowMs: 10000,
  },

  METERED_API_BASE_URL: "https://rtcportal.metered.live/api/v1",

  PER_IP_BANDWIDTH_QUOTA_BYTES:
    parseInt(process.env.PER_IP_BANDWIDTH_QUOTA_BYTES, 10) || 500 * 1024 * 1024,

  GLOBAL_BANDWIDTH_QUOTA_BYTES:
    parseInt(process.env.GLOBAL_BANDWIDTH_QUOTA_BYTES, 10) ||
    20 * 1024 * 1024 * 1024,

  HTTP_STATUS: {
    OK: 200,
    FORBIDDEN: 403,
    INTERNAL_SERVER_ERROR: 500,
  },
};
