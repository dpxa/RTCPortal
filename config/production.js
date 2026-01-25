const {
  DEFAULT_PORT,
  CORS_ORIGINS,
  SOCKET_TRANSPORTS,
} = require("./constants");

module.exports = {
  port: DEFAULT_PORT,
  cors: CORS_ORIGINS.GITHUB_PAGES,
  transports: SOCKET_TRANSPORTS,
};
