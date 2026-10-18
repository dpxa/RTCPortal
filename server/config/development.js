const {
  DEFAULT_PORT,
  DEFAULT_HOST,
  CORS_ORIGINS,
  SOCKET_TRANSPORTS,
} = require("./constants");

module.exports = {
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
  cors: CORS_ORIGINS.LOCALHOST,
  transports: SOCKET_TRANSPORTS,
};