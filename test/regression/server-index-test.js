{
  const { test, before, after } = require("node:test");
  const assert = require("node:assert/strict");
  const { spawn } = require("child_process");
  const path = require("path");

  const SERVER_ENTRY = path.resolve(__dirname, "../../server/index.js");

  const PROJECT_ROOT = path.resolve(__dirname, "../..");
  const TEST_PORT = 3198;
  const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

  let serverProc = null;

  function startServer() {
    return new Promise((resolve, reject) => {
      serverProc = spawn(process.execPath, [SERVER_ENTRY], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          PORT: String(TEST_PORT),
          NODE_ENV: "development",
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

  before(async () => {
    await startServer();
  });

  after(() => stopServer());

  test("GET /api/test returns ok with environment info", async () => {
    const res = await fetch(`${BASE_URL}/api/test`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.environment, "development");
    assert.equal(typeof body.uptime, "number");
    assert.equal(typeof body.timestamp, "number");
  });

  test("GET /api/version returns the version from version.txt", async () => {
    const fs = require("fs");
    const versionFile = path.join(PROJECT_ROOT, "server", "version.txt");
    const original = fs.existsSync(versionFile)
      ? fs.readFileSync(versionFile, "utf8")
      : null;
    fs.writeFileSync(versionFile, "test-version-123\n");

    try {
      const res = await fetch(`${BASE_URL}/api/version`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.version, "test-version-123");
    } finally {
      if (original === null) {
        fs.unlinkSync(versionFile);
      } else {
        fs.writeFileSync(versionFile, original);
      }
    }
  });

  test("GET / serves the frontend index.html in dev mode", async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /RTCPortal/);
  });
}

{
  const { test, before, after } = require("node:test");
  const assert = require("node:assert/strict");
  const { spawn } = require("child_process");
  const path = require("path");
  const { io } = require("socket.io-client");

  const SERVER_ENTRY = path.resolve(__dirname, "../../server/index.js");
  const PROJECT_ROOT = path.resolve(__dirname, "../..");
  const TEST_PORT = 3197;
  const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

  let serverProc = null;
  let clients = [];

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

  function connectInProd() {
    return new Promise((resolve, reject) => {
      const client = io(SERVER_URL, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });
      const timeout = setTimeout(() => {
        client.close();
        reject(new Error("timed out waiting for pin-assigned"));
      }, 10000);
      client.on("pin-assigned", (data) => {
        clearTimeout(timeout);
        client.pin = data.pin;
        clients.push(client);
        resolve(client);
      });
      client.on("connect_error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`connect_error ${err.message}`));
      });
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  before(async () => {
    await startServer();
  });

  after(() => {
    for (const c of clients) c.close();
    clients = [];
    return stopServer();
  });

  test("burst of 50 candidate events survives the rate limiter", async () => {
    const a = await connectInProd();
    const b = await connectInProd();

    await a.emit("offer", {
      target: b.pin,
      sdp: { type: "offer", sdp: "test-sdp" },
    });
    b.emit("answer", { target: a.pin, sdp: { type: "answer", sdp: "ans" } });
    await delay(300);

    const received = [];
    b.on("candidate", (payload) => received.push(payload));

    for (let i = 0; i < 50; i++) {
      a.emit("candidate", {
        target: b.pin,
        candidate: {
          candidate: `candidate:${i}`,
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });
    }
    await delay(1200);

    assert.equal(
      received.length,
      50,
      `expected all 50 candidates to be relayed, got ${received.length}`,
    );
  });

  test("non-signaling events are still rate-limited in production", async () => {
    const c = await connectInProd();

    let rateLimited = 0;
    c.on("rate-limited", () => {
      rateLimited++;
    });

    for (let i = 0; i < 40; i++) {
      c.emit("custom-heartbeat", { i });
    }
    await delay(1200);

    assert.ok(
      rateLimited > 0,
      `expected at least one rate-limited notice, got ${rateLimited}`,
    );
  });
}
