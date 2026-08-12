const { test } = require("node:test");
const assert = require("node:assert/strict");

const constants = require("../../server/config/constants");
const development = require("../../server/config/development");
const production = require("../../server/config/production");

test("constants exports default port and host", () => {
  assert.equal(constants.DEFAULT_PORT, 3000);
  assert.equal(constants.DEFAULT_HOST, "0.0.0.0");
});

test("constants defines API routes and endpoints", () => {
  assert.equal(constants.ROUTES.API, "/api");
  assert.equal(constants.API_ENDPOINTS.TURN_TOKEN, "/turn-token");
  assert.equal(constants.API_ENDPOINTS.TURN_CREDENTIALS, "/turn-credentials");
  assert.equal(constants.API_ENDPOINTS.CONNECTION_STATS, "/connection-stats");
});

test("constants defines CORS origins for GitHub Pages and localhost", () => {
  assert.equal(constants.CORS_ORIGINS.GITHUB_PAGES, "https://dpxa.github.io");
  assert.ok(Array.isArray(constants.CORS_ORIGINS.LOCALHOST));
  assert.ok(constants.CORS_ORIGINS.LOCALHOST.includes("http://localhost:3000"));
});

test("constants defines socket transports", () => {
  assert.deepEqual(constants.SOCKET_TRANSPORTS, ["websocket", "polling"]);
});

test("constants defines rate limits with dev > prod", () => {
  assert.ok(
    constants.RATE_LIMIT.MAX_API_REQUESTS_DEV >
      constants.RATE_LIMIT.MAX_API_REQUESTS_PROD,
  );
  assert.ok(
    constants.RATE_LIMIT.MAX_TURN_REQUESTS_DEV >
      constants.RATE_LIMIT.MAX_TURN_REQUESTS_PROD,
  );
  assert.ok(
    constants.RATE_LIMIT.MAX_TURN_TOKEN_REQUESTS_DEV >
      constants.RATE_LIMIT.MAX_TURN_TOKEN_REQUESTS_PROD,
  );
});

test("constants defines stats rate limit", () => {
  assert.equal(constants.STATS_RATE_LIMIT.maxRequests, 5);
  assert.equal(constants.STATS_RATE_LIMIT.windowMs, 10000);
});

test("constants defines HTTP status codes", () => {
  assert.equal(constants.HTTP_STATUS.OK, 200);
  assert.equal(constants.HTTP_STATUS.FORBIDDEN, 403);
  assert.equal(constants.HTTP_STATUS.INTERNAL_SERVER_ERROR, 500);
});

test("constants defines bandwidth quotas as positive numbers", () => {
  assert.ok(constants.PER_IP_BANDWIDTH_QUOTA_BYTES > 0);
  assert.ok(constants.GLOBAL_BANDWIDTH_QUOTA_BYTES > 0);
});

test("development config uses localhost CORS and default port", () => {
  assert.equal(development.port, 3000);
  assert.equal(development.host, "0.0.0.0");
  assert.deepEqual(development.cors, constants.CORS_ORIGINS.LOCALHOST);
  assert.deepEqual(development.transports, constants.SOCKET_TRANSPORTS);
});

test("production config uses GitHub Pages CORS", () => {
  assert.equal(production.port, 3000);
  assert.equal(production.cors, constants.CORS_ORIGINS.GITHUB_PAGES);
  assert.deepEqual(production.transports, constants.SOCKET_TRANSPORTS);
});
