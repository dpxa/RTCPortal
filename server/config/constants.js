module.exports = {
  ENVIRONMENTS: {
    DEVELOPMENT: "development",
    PRODUCTION: "production",
  },

  DEFAULT_PORT: 3000,

  CORS_ORIGINS: {
    GITHUB_PAGES: "https://dpxa.github.io",
    LOCALHOST: ["http://localhost:3000", "http://127.0.0.1:3000"],
  },

  SOCKET_TRANSPORTS: ["websocket", "polling"],

  API_ENDPOINTS: {
    TURN_CREDENTIALS: "/turn-credentials",
    CONNECTION_STATS: "/connection-stats",
  },

  METERED_API_BASE_URL: "https://rtcportal.metered.live/api/v1",

  HTTP_STATUS: {
    OK: 200,
    FORBIDDEN: 403,
    INTERNAL_SERVER_ERROR: 500,
  },
};
