const { test } = require('node:test');
const assert = require('node:assert/strict');
const constants = require('../../server/config/constants');

test('constants exports default port and host', () => {
  assert.equal(constants.DEFAULT_PORT, 3000);
  assert.equal(constants.DEFAULT_HOST, '0.0.0.0');
});
test('constants defines API routes and endpoints', () => {
  assert.equal(constants.ROUTES.API, '/api');
  assert.equal(constants.API_ENDPOINTS.TURN_TOKEN, '/turn-token');
  assert.equal(constants.API_ENDPOINTS.TURN_CREDENTIALS, '/turn-credentials');
});
test('constants defines CORS origins for GitHub Pages and localhost', () => {
  assert.equal(constants.CORS_ORIGINS.GITHUB_PAGES, 'https://dpxa.github.io');
  assert.ok(Array.isArray(constants.CORS_ORIGINS.LOCALHOST));
});
test('constants defines socket transports', () => {
  assert.deepEqual(constants.SOCKET_TRANSPORTS, ['websocket', 'polling']);
});
test('constants defines rate limits with dev > prod', () => {
  assert.ok(constants.RATE_LIMIT.MAX_API_REQUESTS_DEV > constants.RATE_LIMIT.MAX_API_REQUESTS_PROD);
  assert.ok(constants.RATE_LIMIT.MAX_TURN_REQUESTS_DEV > constants.RATE_LIMIT.MAX_TURN_REQUESTS_PROD);
});
test('constants defines stats rate limit', () => {
  assert.ok(constants.STATS_RATE_LIMIT.windowMs > 0);
  assert.ok(constants.STATS_RATE_LIMIT.maxRequests > 0);
});
test('constants defines HTTP status codes', () => {
  assert.equal(constants.HTTP_STATUS.OK, 200);
  assert.equal(constants.HTTP_STATUS.INTERNAL_SERVER_ERROR, 500);
});
test('constants defines bandwidth quotas as positive numbers', () => {
  assert.ok(constants.PER_IP_BANDWIDTH_QUOTA_BYTES > 0);
  assert.ok(constants.GLOBAL_BANDWIDTH_QUOTA_BYTES > 0);
});
