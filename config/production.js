// Settings for production server
const {
  DEFAULT_PORT,
  CORS_ORIGINS,
  SOCKET_TRANSPORTS,
} = require("./constants");

module.exports = {
  server: {
    port: DEFAULT_PORT,
    cors: {
      origin: CORS_ORIGINS.GITHUB_PAGES,
    },
  },
  socketIO: {
    transports: SOCKET_TRANSPORTS,
  },
};
