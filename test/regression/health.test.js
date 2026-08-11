// Regression tests for the server health endpoint (/api/health).
//
// Boots the real server on an ephemeral port and verifies the health route
// responds correctly, including the static frontend serving in dev mode.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const path = require("path");

const SERVER_ENTRY = path.resolve(__dirname, "../../server/index.js");
// The server serves static files from a relative "public" path, so it must
// be launched with the project root as its working directory.
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const TEST_PORT = 3198;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProc = null;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "development" },
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

test("GET /api/health returns ok with environment info", async () => {
  const res = await fetch(`${BASE_URL}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.environment, "development");
  assert.equal(typeof body.uptime, "number");
  assert.equal(typeof body.timestamp, "number");
});

test("GET / serves the frontend index.html in dev mode", async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /RTCPortal/);
});
