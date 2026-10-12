{
  const { test, before, after } = require("node:test");
  const assert = require("node:assert/strict");
  const { spawn } = require("child_process");
  const path = require("path");

  const SERVER_ENTRY = path.resolve(__dirname, "../../server/index.js");
  const PROJECT_ROOT = path.resolve(__dirname, "../..");
  const TEST_PORT = 3196;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

  // TURN token limiter is 50 req / 15 min in production.
  const TURN_TOKEN_LIMIT_PROD = 50;

  let serverProc = null;

  function startServer() {
    return new Promise((resolve, reject) => {
      serverProc = spawn(process.execPath, [SERVER_ENTRY], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          PORT: String(TEST_PORT),
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let settled = false;
      const buffer = [];
      const onData = (chunk) => {
        buffer.push(chunk.toString());
        if (!settled && /Server bound to/.test(buffer.join(""))) {
          settled = true;
          resolve();
        }
      };
      serverProc.stdout.on("data", onData);
      serverProc.stderr.on("data", onData);
      serverProc.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      serverProc.on("exit", (code) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Server exited before ready (code ${code})`));
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Server did not start within timeout"));
        }
      }, 15000);
    });
  }

  function stopServer() {
    return new Promise((resolve) => {
      if (!serverProc) return resolve();
      serverProc.kill();
      serverProc.on("exit", () => resolve());
      setTimeout(resolve, 2000);
    });
  }

  /**
   * Hit the rate-limited TURN token endpoint while claiming a given client IP
   * via Cloudflare's header. Returns the HTTP status.
   */
  async function hitTurnTokenWithIp(clientIp) {
    const res = await fetch(`${BASE_URL}/api/turn-token`, {
      headers: { "cf-connecting-ip": clientIp },
    });
    return res.status;
  }

  before(async () => {
    await startServer();
  });

  after(() => stopServer());

  test("rate limiter keys buckets by cf-connecting-ip, not the proxy IP", async () => {
    const ipA = "203.0.113.10";
    const ipB = "198.51.100.20";

    // Exhaust client A's bucket.
    for (let i = 0; i < TURN_TOKEN_LIMIT_PROD; i++) {
      const status = await hitTurnTokenWithIp(ipA);
      assert.notEqual(
        status,
        429,
        `request ${i + 1} from ${ipA} should not be rate limited (got ${status})`,
      );
    }

    // Client A is now over its quota.
    assert.equal(
      await hitTurnTokenWithIp(ipA),
      429,
      `expected ${ipA} to be rate limited after ${TURN_TOKEN_LIMIT_PROD} requests`,
    );

    // A different client IP must have its own independent bucket.
    assert.notEqual(
      await hitTurnTokenWithIp(ipB),
      429,
      `expected ${ipB} to have an independent bucket, but it was rate limited`,
    );
  });

  test("the deploy version poll stays under the generic API limiter", async () => {
    // The ci.yml backend poll makes at most 60 requests (1 per 10s, max 600s).
    // The generic API limiter allows 100 / 15 min in production, so the poll
    // must never trip it. This guards against lowering the limit below 60.
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${BASE_URL}/api/version`);
      assert.notEqual(
        res.status,
        429,
        `version poll request ${i + 1} was rate limited`,
      );
    }
  });
}
