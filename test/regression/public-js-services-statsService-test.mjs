import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { bundleModule, createBundleDir, PUBLIC_JS } from './helpers/bundle-client-module.mjs';
import { setupJSDOMEnv, teardownJSDOMEnv } from './helpers/setup-jsdom-env.mjs';

let bundleDir;
let originalSetTimeout;
let originalSetInterval;
let originalClearInterval;

beforeEach(async () => {
  setupJSDOMEnv();
  bundleDir = createBundleDir();
  originalSetTimeout = globalThis.setTimeout;
  originalSetInterval = globalThis.setInterval;
  originalClearInterval = globalThis.clearInterval;
});

afterEach(() => {
  teardownJSDOMEnv();
  globalThis.setTimeout = originalSetTimeout;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
});

function statsPayload(successRate) {
  return {
    successRate,
    uptimeMs: 1000,
    totalBytesTransferred: 0,
    totalFilesTransferred: 0,
  };
}

async function loadStatsService({ responses = [], pending } = {}) {
  const calls = [];
  const intervals = [];
  let callIndex = 0;

  globalThis.setInterval = (fn, delay) => {
    const handle = { fn, delay, cleared: false };
    intervals.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    if (handle && typeof handle === 'object') handle.cleared = true;
  };

  globalThis.fetch = async (url) => {
    calls.push(url);
    const index = callIndex++;
    if (pending) {
      return new Promise((resolve) => pending.push({ index, resolve }));
    }
    const body = responses[Math.min(index, responses.length - 1)];
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body };
  };

  const mod = await bundleModule(
    path.join(PUBLIC_JS, 'services/statsService.js'),
    bundleDir,
  );

  const settle = () => new Promise((resolve) => originalSetTimeout(resolve, 0));
  const display = () =>
    globalThis.document.getElementById('success-rate-display').textContent;

  return { service: mod.statsService, calls, intervals, settle, display };
}

test('services/statsService.js loads without errors', async () => {
  const mod = await bundleModule(
    path.join(PUBLIC_JS, 'services/statsService.js'),
    bundleDir,
  );
  assert.ok(mod.statsService, 'statsService must be exported');
});

test('renders the server-tracked value on the first fetch', async () => {
  const { settle, display, service } = await loadStatsService({
    responses: [statsPayload(100)],
  });

  await settle();

  assert.equal(display(), '100%');
  assert.equal(service.hasStats, true);
});

test('requests during an in-flight fetch share it instead of piling up', async () => {
  const pending = [];
  const { service, calls, settle } = await loadStatsService({ pending });

  assert.equal(calls.length, 1, 'the constructor fetches once');

  const alsoReturned = service.requestConnectionStats();
  service.requestConnectionStats();
  assert.equal(calls.length, 1, 'no extra request while one is in flight');
  assert.equal(
    alsoReturned,
    service.fetchInFlight,
    'callers receive the in-flight request so they can await the outcome',
  );

  pending[0].resolve({ ok: true, json: async () => statsPayload(100) });
  await settle();

  assert.equal(calls.length, 1, 'settling does not replay the request');
  assert.equal(service.fetchInFlight, null, 'the request is released');
});

test('a burst of callers results in one request per settle, never a pile-up', async () => {
  const { service, calls, settle, display } = await loadStatsService({
    responses: [statsPayload(100), statsPayload(50)],
  });

  await settle();
  assert.equal(calls.length, 1);

  for (let i = 0; i < 5; i++) service.requestConnectionStats();
  assert.equal(
    calls.length,
    2,
    'a burst while idle starts exactly one new request',
  );

  await settle();
  assert.equal(calls.length, 2, 'the rest of the burst was coalesced');
  assert.equal(display(), '50%');
});

test('a transient failure keeps the last good value rather than blanking it', async () => {
  const { service, settle, display } = await loadStatsService({
    responses: [statsPayload(50), new Error('rate limited')],
  });

  await settle();
  assert.equal(display(), '50%');

  service.requestConnectionStats();
  await settle();

  assert.equal(display(), '50%', 'the last good value survives a failed fetch');
});

test('a failure before any value has arrived shows the error state', async () => {
  const { settle, display } = await loadStatsService({
    responses: [new Error('offline')],
  });

  await settle();

  assert.equal(display(), 'Error');
});

test('cleanup stops the polling interval', async () => {
  const { service, intervals, settle } = await loadStatsService({
    responses: [statsPayload(100)],
  });

  await settle();
  assert.equal(intervals.length, 1, 'polling is registered on construction');
  assert.equal(intervals[0].delay, 30000);

  service.cleanup();

  assert.equal(service.statsIntervalId, null);
  assert.equal(intervals[0].cleared, true, 'the interval must be cleared');
});

test('stats keep working after cleanup so a restored page is not frozen', async () => {
  const { service, calls, settle, display } = await loadStatsService({
    responses: [statsPayload(100), statsPayload(75)],
  });

  await settle();
  assert.equal(display(), '100%');

  service.cleanup();
  service.requestConnectionStats();
  await settle();

  assert.equal(calls.length, 2, 'a bfcache-restored page must still fetch');
  assert.equal(display(), '75%');
});

test('a pushed value is applied even after cleanup', async () => {
  const { service, settle, display } = await loadStatsService({
    responses: [statsPayload(100)],
  });

  await settle();
  service.cleanup();
  service.applyStats(statsPayload(30));

  assert.equal(display(), '30%');
});

test('a malformed pushed payload is ignored', async () => {
  const { service, settle, display } = await loadStatsService({
    responses: [statsPayload(100)],
  });

  await settle();

  service.applyStats(null);
  service.applyStats('nope');
  service.applyStats(undefined);

  assert.equal(display(), '100%', 'the display keeps the last good value');
});

test('a stale fetch must not overwrite a newer pushed value', async () => {
  const deferred = [];
  const { service, settle, display } = await loadStatsService({
    pending: deferred,
  });

  service.applyStats(statsPayload(100));
  await settle();
  assert.equal(display(), '100%', 'the pushed value renders');

  deferred[0].resolve({ ok: true, json: async () => statsPayload(0) });
  await settle();

  assert.equal(
    display(),
    '100%',
    'a fetch started before the push must not clobber the newer value',
  );
});
