{
  const { test, before, after } = require("node:test");
  const assert = require("node:assert/strict");
  const { spawn } = require("child_process");
  const path = require("path");

  const SERVER_ENTRY = path.resolve(__dirname, "../../server/index.js");
  const PROJECT_ROOT = path.resolve(__dirname, "../..");
  const TEST_PORT = 3196;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

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

    for (let i = 0; i < TURN_TOKEN_LIMIT_PROD; i++) {
      const status = await hitTurnTokenWithIp(ipA);
      assert.notEqual(
        status,
        429,
        `request ${i + 1} from ${ipA} should not be rate limited (got ${status})`,
      );
    }

    assert.equal(
      await hitTurnTokenWithIp(ipA),
      429,
      `expected ${ipA} to be rate limited after ${TURN_TOKEN_LIMIT_PROD} requests`,
    );

    assert.notEqual(
      await hitTurnTokenWithIp(ipB),
      429,
      `expected ${ipB} to have an independent bucket, but it was rate limited`,
    );
  });

  test("the deploy version poll stays under the generic API limiter", async () => {
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
