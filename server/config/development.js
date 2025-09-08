// Settings for development server
const {
  DEFAULT_PORT,
  CORS_ORIGINS,
  SOCKET_TRANSPORTS,
} = require("./constants");

module.exports = {
  port: DEFAULT_PORT,
  transports: SOCKET_TRANSPORTS,
};
