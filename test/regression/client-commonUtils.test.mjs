import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPureModule } from "./helpers/load-client-module.mjs";

let appUtils;
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
const originalSubtle = globalThis.crypto?.subtle;
let originalWarn;

beforeEach(async () => {
  originalWarn = console.warn;
  appUtils = (await loadPureModule("commonUtils")).appUtils;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.document = originalDocument;

  try {
    Object.defineProperty(globalThis, "crypto", {
      value: { subtle: originalSubtle },
      configurable: true,
      writable: true,
    });
  } catch {}
  console.warn = originalWarn;
});

function stubCryptoSubtle(subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: { subtle },
    configurable: true,
    writable: true,
  });
}

test("safeJsonParse returns parsed object for valid JSON string", () => {
  const result = appUtils.safeJsonParse('{"a":1}');
  assert.deepEqual(result, { a: 1 });
});

test("safeJsonParse returns null for non-string input", () => {
  assert.equal(appUtils.safeJsonParse(42), null);
  assert.equal(appUtils.safeJsonParse(null), null);
  assert.equal(appUtils.safeJsonParse(undefined), null);
});

test("safeJsonParse returns null and warns on malformed JSON", () => {
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  try {
    assert.equal(appUtils.safeJsonParse("{not json"), null);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
});

test("formatBytes returns '0 Bytes' for <= 0 input", () => {
  assert.equal(appUtils.formatBytes(0), "0 Bytes");
  assert.equal(appUtils.formatBytes(-5), "0 Bytes");
});

test("formatBytes returns bytes with no decimals", () => {
  assert.equal(appUtils.formatBytes(512), "512 Bytes");
});

test("formatBytes formats KB/MB/GB with two decimals", () => {
  assert.equal(appUtils.formatBytes(1024), "1.00 KB");
  assert.equal(appUtils.formatBytes(1024 * 1024), "1.00 MB");
  assert.equal(appUtils.formatBytes(1024 * 1024 * 1024), "1.00 GB");
});

test("formatBytes handles non-numeric input as 0", () => {
  assert.equal(appUtils.formatBytes("abc"), "0 Bytes");
  assert.equal(appUtils.formatBytes(null), "0 Bytes");
});

test("formatUptime returns seconds for sub-minute durations", () => {
  assert.equal(appUtils.formatUptime(5000), "5 seconds");
  assert.equal(appUtils.formatUptime(1000), "1 second");
});

test("formatUptime returns minutes", () => {
  assert.equal(appUtils.formatUptime(120000), "2 minutes");
  assert.equal(appUtils.formatUptime(60000), "1 minute");
});

test("formatUptime returns hours", () => {
  assert.equal(appUtils.formatUptime(3600000 * 2), "2 hours");
});

test("formatUptime returns days", () => {
  assert.equal(appUtils.formatUptime(86400000 * 3), "3 days");
});

test("formatUptime handles non-numeric input as 0 seconds", () => {
  assert.equal(appUtils.formatUptime("junk"), "0 seconds");
  assert.equal(appUtils.formatUptime(undefined), "0 seconds");
});

test("formatUptime floors negative input (no clamping)", () => {
  assert.equal(appUtils.formatUptime(-1), "-1 seconds");
});

test("wait resolves after approximately the given delay", async () => {
  const start = Date.now();
  await appUtils.wait(50);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 40, `elapsed ${elapsed} should be >= 40`);
});

test("wait clamps negative/NaN delays to 0", async () => {
  const start = Date.now();
  await appUtils.wait(-10);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 50);
});

test("requestJson returns parsed JSON on success", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: 1 }),
  });
  const result = await appUtils.requestJson("http://x/api");
  assert.deepEqual(result, { data: 1 });
});

test("requestJson throws with status and details on error response", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    statusText: "Bad Request",
    json: async () => ({ error: "bad payload" }),
  });
  await assert.rejects(
    () => appUtils.requestJson("http://x/api", { errorPrefix: "API failed" }),
    /API failed: 400 Bad Request\. bad payload/,
  );
});

test("requestJson throws without details when error body is not JSON", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    json: async () => {
      throw new Error("not json");
    },
  });
  await assert.rejects(
    () => appUtils.requestJson("http://x/api"),
    /Request failed: 500 Internal Server Error\./,
  );
});

test("requestJson propagates network errors", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  await assert.rejects(
    () => appUtils.requestJson("http://x/api"),
    /network down/,
  );
});

test("isPageHidden returns document.hidden when available", () => {
  globalThis.document = { hidden: true };
  assert.equal(appUtils.isPageHidden(), true);
  globalThis.document = { hidden: false };
  assert.equal(appUtils.isPageHidden(), false);
});

test("isPageHidden returns false when document throws", () => {
  globalThis.document = undefined;
  assert.equal(appUtils.isPageHidden(), false);
});

test("sha256 returns hex digest for a buffer", async () => {
  const digest = await appUtils.sha256(new Uint8Array([65]));
  assert.equal(digest.length, 64);
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("sha256 returns null when crypto.subtle is unavailable", async () => {
  stubCryptoSubtle({
    digest: async () => {
      throw new Error("no crypto");
    },
  });
  assert.equal(await appUtils.sha256(new Uint8Array([1])), null);
});

test("sha256Blob hashes a blob via arrayBuffer", async () => {
  const blob = {
    arrayBuffer: async () => new Uint8Array([65]).buffer,
  };
  const digest = await appUtils.sha256Blob(blob);
  assert.equal(digest.length, 64);
});

test("sha256Blob returns null when arrayBuffer fails", async () => {
  const blob = {
    arrayBuffer: async () => {
      throw new Error("no blob");
    },
  };
  const result = await appUtils.sha256Blob(blob);
  assert.equal(result, null);
});
