// Regression tests for server/routes/api.js
//
// Mounts the API router on a minimal Express app backed by a real
// ConnectionStats instance, then exercises each endpoint over HTTP using
// Node's built-in fetch. Covers TURN token, TURN credentials, and
// connection-stats endpoints including quota/authorization edge cases.

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("http");

const ConnectionStats = require("../../server/utils/connectionStats");
const {
  API_ENDPOINTS,
  HTTP_STATUS,
  ROUTES,
} = require("../../server/config/constants");

let server;
let baseUrl;
let stats;
let originalFetch;
let originalTurnSecret;
let originalMeteredKey;

// The router is mounted under ROUTES.API ("/api"), so endpoint paths are
// relative to that prefix.
const apiPath = (endpoint) => `${ROUTES.API}${endpoint}`;

// Reloads the api router fresh so it picks up current env vars.
function loadRouter() {
  const apiPathResolved = require.resolve("../../server/routes/api");
  delete require.cache[apiPathResolved];
  return require("../../server/routes/api");
}

before(async () => {
  originalFetch = globalThis.fetch;
  originalTurnSecret = process.env.TURN_TOKEN_SECRET;
  originalMeteredKey = process.env.METERED_API_KEY;

  stats = new ConnectionStats.constructor();
  const app = express();
  app.set("connectionStats", stats);
  app.use(express.json());
  app.use(ROUTES.API, loadRouter());

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  globalThis.fetch = originalFetch;
  process.env.TURN_TOKEN_SECRET = originalTurnSecret;
  process.env.METERED_API_KEY = originalMeteredKey;
});

beforeEach(() => {
  // Reset stats between tests for isolation.
  stats.totalAttempts = 0;
  stats.successfulConnections = 0;
  stats.totalBytesTransferred = 0;
  stats.totalFilesTransferred = 0;
  stats.ipBandwidth.clear();
});

test("GET /api/connection-stats returns stats with quota fields", async () => {
  stats.incrementAttempts();
  stats.incrementSuccesses();
  stats.addTransfer(2048, 2);

  const res = await fetch(
    `${baseUrl}${apiPath(API_ENDPOINTS.CONNECTION_STATS)}`,
  );
  assert.equal(res.status, HTTP_STATUS.OK);
  const body = await res.json();
  assert.equal(body.successRate, 100);
  assert.equal(body.totalBytesTransferred, 2048);
  assert.equal(body.totalFilesTransferred, 2);
  assert.equal(typeof body.perIpBandwidthQuotaBytes, "number");
  assert.equal(typeof body.globalBandwidthQuotaBytes, "number");
  assert.equal(typeof body.globalBandwidthUsedBytes, "number");
});

test("GET /api/turn-token returns 500 when TURN secret not configured", async () => {
  // In the test environment TURN_TOKEN_SECRET is unset, so the token
  // generator returns null -> 500.
  const res = await fetch(`${baseUrl}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
  assert.equal(res.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  const body = await res.json();
  assert.ok(body.error);
});

test("GET /api/turn-token returns a token when TURN secret is configured", async () => {
  process.env.TURN_TOKEN_SECRET = "test-secret";
  // Reload router so it picks up the secret.
  const app = express();
  app.set("connectionStats", stats);
  app.use(express.json());
  app.use(ROUTES.API, loadRouter());
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const url = `http://127.0.0.1:${srv.address().port}`;

  try {
    const res = await fetch(`${url}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
    assert.equal(res.status, HTTP_STATUS.OK);
    const body = await res.json();
    assert.equal(typeof body.token, "string");
    assert.ok(body.token.includes("."));
    assert.equal(typeof body.expiresIn, "number");
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
  }
});

test("GET /api/turn-token returns 403 when per-IP quota exhausted", async () => {
  // Simulate an IP that has used all its bandwidth. Cover the loopback
  // variants Express may report for req.ip.
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    stats.addIpBandwidth(ip, Number.MAX_SAFE_INTEGER);
  }
  const res = await fetch(`${baseUrl}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
  assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
  const body = await res.json();
  assert.match(body.error, /quota/i);
});

// Builds a fresh app+server with a TURN secret and returns { url, token }.
async function setupTurnServer(secret = "test-secret") {
  process.env.TURN_TOKEN_SECRET = secret;
  const app = express();
  app.set("connectionStats", stats);
  app.use(express.json());
  app.use(ROUTES.API, loadRouter());
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const url = `http://127.0.0.1:${srv.address().port}`;
  // Obtain a valid token.
  const tokenRes = await fetch(`${url}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
  const { token } = await tokenRes.json();
  return { url, token, srv };
}

test("GET /api/turn-credentials accepts bearer token in Authorization header", async () => {
  const { url, token, srv } = await setupTurnServer();
  try {
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    // No METERED_API_KEY -> 500 after passing auth, proving token accepted.
    assert.equal(res.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    assert.match(body.error, /API key not configured/i);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/turn-credentials rejects a tampered signature", async () => {
  const { url, token, srv } = await setupTurnServer();
  try {
    const tampered = token.slice(0, -4) + "ffff";
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(tampered)}`,
    );
    assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
    const body = await res.json();
    assert.match(body.error, /Forbidden/i);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
  }
});

test("GET /api/turn-credentials rejects a token with no signature", async () => {
  const { url, srv } = await setupTurnServer();
  try {
    const noSig = "1699999999999:127.0.0.1"; // no dot -> no signature
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(noSig)}`,
    );
    assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
  }
});

test("GET /api/turn-credentials rejects an expired token", async () => {
  const { url, srv } = await setupTurnServer();
  try {
    // Hand-craft an expired token signed correctly but with a past expiry.
    const crypto = require("crypto");
    const payload = `${Date.now() - 60000}:127.0.0.1`;
    const sig = crypto
      .createHmac("sha256", "test-secret")
      .update(payload)
      .digest("hex");
    const expired = `${payload}.${sig}`;
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(expired)}`,
    );
    assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
  }
});

test("GET /api/turn-credentials returns 403 without a valid token", async () => {
  const res = await fetch(
    `${baseUrl}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}`,
  );
  assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
  const body = await res.json();
  assert.match(body.error, /Forbidden/i);
});

test("GET /api/turn-credentials returns 403 with an invalid token", async () => {
  const res = await fetch(
    `${baseUrl}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=invalid-token`,
  );
  assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
});

test("GET /api/turn-credentials returns 403 when per-IP quota exhausted", async () => {
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    stats.addIpBandwidth(ip, Number.MAX_SAFE_INTEGER);
  }
  const res = await fetch(
    `${baseUrl}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=anything`,
  );
  assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
  const body = await res.json();
  assert.match(body.error, /quota/i);
});

test("GET /api/turn-credentials returns 500 when API key not configured", async () => {
  // Provide a valid token but no METERED_API_KEY.
  process.env.TURN_TOKEN_SECRET = "test-secret";
  const app = express();
  app.set("connectionStats", stats);
  app.use(express.json());
  app.use(ROUTES.API, loadRouter());
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const url = `http://127.0.0.1:${srv.address().port}`;

  try {
    // Generate a valid token via the token endpoint.
    const tokenRes = await fetch(`${url}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
    const { token } = await tokenRes.json();
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(token)}`,
    );
    assert.equal(res.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    assert.match(body.error, /API key not configured/i);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
  }
});

test("GET /api/turn-credentials returns servers when Metered API succeeds", async () => {
  process.env.TURN_TOKEN_SECRET = "test-secret";
  process.env.METERED_API_KEY = "metered-key";
  // Only intercept the external Metered call; pass through local fetches.
  globalThis.fetch = async (input) => {
    if (String(input).includes("metered.live")) {
      return {
        ok: true,
        json: async () => [{ urls: "turn:example.com:3478" }],
      };
    }
    return originalFetch(input);
  };

  const app = express();
  app.set("connectionStats", stats);
  app.use(express.json());
  app.use(ROUTES.API, loadRouter());
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const url = `http://127.0.0.1:${srv.address().port}`;

  try {
    const tokenRes = await fetch(`${url}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
    const { token } = await tokenRes.json();
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(token)}`,
    );
    assert.equal(res.status, HTTP_STATUS.OK);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body[0].urls, "turn:example.com:3478");
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
    delete process.env.METERED_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/turn-credentials returns 500 when Metered API fails", async () => {
  process.env.TURN_TOKEN_SECRET = "test-secret";
  process.env.METERED_API_KEY = "metered-key";
  // Only intercept the external Metered call; pass through local fetches.
  globalThis.fetch = async (input) => {
    if (String(input).includes("metered.live")) {
      return {
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => ({ error: "upstream down" }),
      };
    }
    return originalFetch(input);
  };

  const app = express();
  app.set("connectionStats", stats);
  app.use(express.json());
  app.use(ROUTES.API, loadRouter());
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const url = `http://127.0.0.1:${srv.address().port}`;

  try {
    const tokenRes = await fetch(`${url}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
    const { token } = await tokenRes.json();
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(token)}`,
    );
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.match(body.error, /upstream down/);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
    delete process.env.METERED_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/turn-credentials returns 500 when Metered fetch throws", async () => {
  process.env.TURN_TOKEN_SECRET = "test-secret";
  process.env.METERED_API_KEY = "metered-key";
  // Only intercept the external Metered call; pass through local fetches.
  globalThis.fetch = async (input) => {
    if (String(input).includes("metered.live")) {
      throw new Error("socket hang up");
    }
    return originalFetch(input);
  };

  const app = express();
  app.set("connectionStats", stats);
  app.use(express.json());
  app.use(ROUTES.API, loadRouter());
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, resolve));
  const url = `http://127.0.0.1:${srv.address().port}`;

  try {
    const tokenRes = await fetch(`${url}${apiPath(API_ENDPOINTS.TURN_TOKEN)}`);
    const { token } = await tokenRes.json();
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(token)}`,
    );
    assert.equal(res.status, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    const body = await res.json();
    assert.match(body.error, /socket hang up/);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
    delete process.env.METERED_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/turn-credentials returns empty array when Metered returns none", async () => {
  process.env.TURN_TOKEN_SECRET = "test-secret";
  process.env.METERED_API_KEY = "metered-key";
  globalThis.fetch = async (input) => {
    if (String(input).includes("metered.live")) {
      return { ok: true, json: async () => [] };
    }
    return originalFetch(input);
  };

  const { url, token, srv } = await setupTurnServer();
  try {
    const res = await fetch(
      `${url}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=${encodeURIComponent(token)}`,
    );
    assert.equal(res.status, HTTP_STATUS.OK);
    const body = await res.json();
    assert.deepEqual(body, []);
  } finally {
    srv.close();
    delete process.env.TURN_TOKEN_SECRET;
    delete process.env.METERED_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/turn-credentials returns 403 when global quota exhausted", async () => {
  // Give the requesting IP usage, then fill the map past the global quota.
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    stats.addIpBandwidth(ip, 1000);
  }
  for (let n = 1; n <= 100; n++) {
    stats.addIpBandwidth(`10.1.1.${n}`, Number.MAX_SAFE_INTEGER);
  }

  const res = await fetch(
    `${baseUrl}${apiPath(API_ENDPOINTS.TURN_CREDENTIALS)}?token=anything`,
  );
  assert.equal(res.status, HTTP_STATUS.FORBIDDEN);
  const body = await res.json();
  assert.ok(body.error);
});

test("unknown API route returns 404", async () => {
  const res = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(res.status, 404);
});
