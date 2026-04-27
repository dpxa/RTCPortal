module.exports = {
  DEFAULT_PORT: 3000,

  ROUTES: {
    TEST: "/test",
    API: "/api",
  },

  CORS_ORIGINS: {
    GITHUB_PAGES: "https://dpxa.github.io",
  },

  SOCKET_TRANSPORTS: ["websocket", "polling"],

  API_ENDPOINTS: {
    TURN_CREDENTIALS: "/turn-credentials",
    CONNECTION_STATS: "/connection-stats",
  },

  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_API_REQUESTS_DEV: 1000,
    MAX_API_REQUESTS_PROD: 100,
    MAX_TURN_REQUESTS_DEV: 200,
    MAX_TURN_REQUESTS_PROD: 20,
    MESSAGES: {
      API_LIMIT: "Too many requests from this IP, please try again later.",
      TURN_LIMIT: "Too many TURN credential requests, please try again later.",
    },
  },

  METERED_API_BASE_URL: "https://rtcportal.metered.live/api/v1",

  HTTP_STATUS: {
    OK: 200,
    FORBIDDEN: 403,
    INTERNAL_SERVER_ERROR: 500,
  },
};
