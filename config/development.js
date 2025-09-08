// Settings for development server
const {
  DEFAULT_PORT,
  CORS_ORIGINS,
  SOCKET_TRANSPORTS,
} = require("./constants");

module.exports = {
  server: {
    port: DEFAULT_PORT,
    cors: {
      origin: CORS_ORIGINS.LOCALHOST,
    },
  },
  socketIO: {
    transports: SOCKET_TRANSPORTS,
  },
};
