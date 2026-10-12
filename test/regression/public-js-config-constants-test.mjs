import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../../public/js/config/constants.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtcportal-constants-"));

const originalWindow = globalThis.window;

let loadCounter = 0;

async function loadConstants(hostname) {
  globalThis.window = { location: { hostname } };
  const dest = path.join(tempDir, `constants-${loadCounter++}.mjs`);
  fs.copyFileSync(SRC, dest);
  const mod = await import(pathToFileURL(dest).href);
  return mod;
}

afterEach(() => {
  globalThis.window = originalWindow;
});

test("local hostname (localhost) sets environmentIsProd=false and empty BASE_API_URL", async () => {
  const c = await loadConstants("localhost");
  assert.equal(c.environmentIsProd, false);
  assert.equal(c.BASE_API_URL, "");
});

test("127.0.0.1 hostname is treated as local", async () => {
  const c = await loadConstants("127.0.0.1");
  assert.equal(c.environmentIsProd, false);
});

test("private 192.168.x.x hostname is treated as local", async () => {
  const c = await loadConstants("192.168.1.10");
  assert.equal(c.environmentIsProd, false);
});

test("private 10.x.x.x hostname is treated as local", async () => {
  const c = await loadConstants("10.0.0.5");
  assert.equal(c.environmentIsProd, false);
});

test("IPv6 loopback (::1) is treated as local", async () => {
  const c = await loadConstants("::1");
  assert.equal(c.environmentIsProd, false);
});

test("public hostname sets environmentIsProd=true and PROD_API_URL", async () => {
  const c = await loadConstants("dpxa.github.io");
  assert.equal(c.environmentIsProd, true);
  assert.equal(c.BASE_API_URL, c.PROD_API_URL);
});

test("API_ENDPOINTS are defined with expected paths", async () => {
  const c = await loadConstants("localhost");
  assert.equal(c.API_ENDPOINTS.TURN_TOKEN, "/api/turn-token");
  assert.equal(c.API_ENDPOINTS.TURN_CREDENTIALS, "/api/turn-credentials");
  assert.equal(c.API_ENDPOINTS.CONNECTION_STATS, "/api/connection-stats");
});

test("RTC_CONFIG includes STUN servers and unified-plan semantics", async () => {
  const c = await loadConstants("localhost");
  assert.ok(Array.isArray(c.RTC_CONFIG.iceServers));
  assert.ok(c.RTC_CONFIG.iceServers.length >= 1);
  assert.equal(c.RTC_CONFIG.sdpSemantics, "unified-plan");
  assert.equal(c.RTC_CONFIG.iceCandidatePoolSize, 2);
});

test("key numeric constants are exported with expected values", async () => {
  const c = await loadConstants("localhost");
  assert.equal(c.SLICE_SIZE, 65536);
  assert.equal(c.DATA_CHANNEL_BUFFERED_AMOUNT_LOW_THRESHOLD, 1048576);
  assert.equal(c.DATA_CHANNEL_BUFFERED_AMOUNT_LIMIT, 4194304);
  assert.equal(c.CONNECTION_TIMEOUT, 30000);
  assert.equal(c.HEARTBEAT_INTERVAL, 15000);
  assert.equal(c.MAX_RECEIVE_BATCH_SIZE, 2 * 1024 * 1024 * 1024);
});

test("SOCKET_TRANSPORTS includes websocket and polling", async () => {
  const c = await loadConstants("localhost");
  assert.deepEqual(c.SOCKET_TRANSPORTS, ["websocket", "polling"]);
});

test("WARNING_TIMEOUT is ALERT_TIMEOUT + 2000", async () => {
  const c = await loadConstants("localhost");
  assert.equal(c.WARNING_TIMEOUT, c.ALERT_TIMEOUT + 2000);
});
