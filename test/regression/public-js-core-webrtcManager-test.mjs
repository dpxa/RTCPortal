import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { bundleModule, createBundleDir, PUBLIC_JS } from './helpers/bundle-client-module.mjs';
import { setupJSDOMEnv, teardownJSDOMEnv } from './helpers/setup-jsdom-env.mjs';

let bundleDir;

beforeEach(async () => {
  setupJSDOMEnv();
  bundleDir = createBundleDir();
});

afterEach(() => {
  teardownJSDOMEnv();
});

test('core/webrtcManager.js loads without errors', async () => {
  const mod = await bundleModule(
    path.join(PUBLIC_JS, 'core/webrtcManager.js'),
    bundleDir,
  );
  assert.ok(mod.webrtcManager, 'webrtcManager must be exported');
});

async function loadManagerWithRecordingSocket() {
  const emitted = [];

  globalThis.io = () => ({
    id: 'recording-socket',
    on: () => {},
    off: () => {},
    emit: (event, payload) => {
      emitted.push({ event, payload });
    },
    disconnect: () => {},
  });

  const mod = await bundleModule(
    path.join(PUBLIC_JS, 'core/webrtcManager.js'),
    bundleDir,
  );

  const manager = mod.webrtcManager;
  const attemptEvents = () =>
    emitted.filter((e) => e.event.startsWith('connection-'));

  return { manager, emitted, attemptEvents };
}

test('a successful connection reports its attempt id exactly once', async () => {
  const { manager, attemptEvents } = await loadManagerWithRecordingSocket();

  manager._activeAttemptId = 42;
  manager.dataChannel = { readyState: 'open' };
  manager.controlChannel = { readyState: 'open' };

  const conn = { _attemptId: 42, _successEmitted: false };
  manager._checkAndEmitSuccess(conn);
  manager._checkAndEmitSuccess(conn);

  const successes = attemptEvents().filter(
    (e) => e.event === 'connection-success',
  );
  assert.equal(successes.length, 1, 'duplicate success must be suppressed');
  assert.deepEqual(successes[0].payload, { attemptId: 42 });
  assert.equal(conn._successEmitted, true);
  assert.equal(manager._activeAttemptId, null, 'the attempt is now settled');
});

test('the success guard holds even when the emitter is called directly', async () => {
  const { manager, attemptEvents } = await loadManagerWithRecordingSocket();

  const conn = { _attemptId: 42, _successEmitted: false };
  manager._emitAttemptSuccess(conn);
  manager._emitAttemptSuccess(conn);

  assert.deepEqual(attemptEvents(), [
    { event: 'connection-success', payload: { attemptId: 42 } },
  ]);
});

test('a connection without open channels defers success and reports nothing', async () => {
  const { manager, attemptEvents } = await loadManagerWithRecordingSocket();

  manager._activeAttemptId = 42;
  manager.dataChannel = { readyState: 'connecting' };
  manager.controlChannel = { readyState: 'connecting' };
  manager._checkAndEmitSuccess({ _attemptId: 42, _successEmitted: false });

  assert.equal(manager._pendingSuccessEmit, true);
  assert.equal(attemptEvents().length, 0);
});

test('an outcome without an id is never reported to the server', async () => {
  const { manager, attemptEvents } = await loadManagerWithRecordingSocket();

  manager._emitAttemptSuccess({ _attemptId: null, _successEmitted: false });
  manager._emitAttemptFailure();
  assert.equal(attemptEvents().length, 0);

  manager._activeAttemptId = 7;
  manager.abortPendingConnection(true);
  assert.deepEqual(attemptEvents(), [
    { event: 'connection-user-failed', payload: { attemptId: 7 } },
  ]);
  assert.equal(manager._activeAttemptId, null);

  manager._emitAttemptFailure();
  assert.equal(attemptEvents().length, 1);
});

test('configureConnection stamps the attempt id onto the connection', async () => {
  const { manager } = await loadManagerWithRecordingSocket();

  const conn = {
    addEventListener: () => {},
    createDataChannel: () => ({ addEventListener: () => {}, close: () => {} }),
  };
  manager.configureConnection(conn, 'peer-pin', true, 99);

  assert.equal(conn._attemptId, 99);
  assert.equal(conn._peerId, 'peer-pin');
  assert.equal(conn._isInitiator, true);
  assert.equal(conn._successEmitted, false);
  assert.deepEqual(conn._candidateQueue, []);
});

test('retrying while an attempt is pending leaves the new attempt usable', async () => {
  const { manager, attemptEvents } = await loadManagerWithRecordingSocket();

  globalThis.RTCPeerConnection = class {
    constructor() {
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.localDescription = null;
    }
    addEventListener() {}
    createDataChannel() {
      return {
        addEventListener: () => {},
        close: () => {},
        readyState: 'connecting',
      };
    }
    async createOffer() {
      return { type: 'offer', sdp: 'stub-offer' };
    }
    async setLocalDescription() {}
    close() {}
  };

  manager.selfId = 'self-id';
  manager.socket = globalThis.io();
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  globalThis.document.getElementById('partner-id-field').value = 'peer-1';

  manager.pendingPeerConnection = { close: () => {}, addEventListener: () => {} };
  manager.newConnTimer = setTimeout(() => {}, 100000);
  manager.connectionAttemptId = 6;
  manager._activeAttemptId = 6;

  await manager.initiateConnection();
  if (manager.newConnTimer) clearTimeout(manager.newConnTimer);

  assert.equal(
    manager.connectionAttemptId,
    8,
    'the new attempt id must survive the abort of the previous attempt',
  );
  assert.equal(
    manager._isStaleAttempt(manager.connectionAttemptId),
    false,
    'the replacement attempt must not be treated as stale',
  );
  assert.equal(
    manager._activeAttemptId,
    manager.connectionAttemptId,
    'the new attempt is the active one',
  );

  const failures = attemptEvents().filter(
    (e) => e.event === 'connection-user-failed',
  );
  assert.deepEqual(
    failures,
    [{ event: 'connection-user-failed', payload: { attemptId: 6 } }],
    `the superseded attempt is settled exactly once, got ${JSON.stringify(attemptEvents())}`,
  );
  assert.deepEqual(
    attemptEvents().filter((e) => e.event === 'connection-attempt'),
    [{ event: 'connection-attempt', payload: { attemptId: 8 } }],
    'the new attempt must be reported',
  );
});

test('a late error from a superseded attempt never tears down the live one', async () => {
  const { manager, attemptEvents } = await loadManagerWithRecordingSocket();

  const aborts = [];
  manager.abortPendingConnection = (emitUserFail) => {
    aborts.push(emitUserFail);
  };
  manager.connectionAttemptId = 5;
  manager._activeAttemptId = 5;

  manager._handlePendingConnectionError({
    attemptId: 4,
    error: new Error('late failure'),
    logMessage: 'late failure',
  });

  assert.deepEqual(
    aborts,
    [],
    'an error carrying a superseded attempt id must be ignored',
  );
  assert.equal(
    manager._activeAttemptId,
    5,
    'the live attempt is still the active one',
  );
  assert.equal(attemptEvents().length, 0);
});

test('an error from the live attempt aborts it', async () => {
  const { manager } = await loadManagerWithRecordingSocket();

  const aborts = [];
  manager.abortPendingConnection = (emitUserFail) => {
    aborts.push(emitUserFail);
  };
  manager.resetConnectionTiming = () => {};
  manager.connectionAttemptId = 5;
  manager._activeAttemptId = 5;

  manager._handlePendingConnectionError({
    attemptId: 5,
    error: new Error('live failure'),
    logMessage: 'live failure',
  });

  assert.deepEqual(aborts, [true], 'the live attempt must be aborted');
});

test('an attempt superseded mid-handshake never opens a peer connection', async () => {
  const { manager } = await loadManagerWithRecordingSocket();

  let peerConnectionsCreated = 0;
  globalThis.RTCPeerConnection = class {
    constructor() {
      peerConnectionsCreated++;
    }
    addEventListener() {}
    createDataChannel() {
      return { addEventListener: () => {}, close: () => {} };
    }
    async createOffer() {
      return { type: 'offer', sdp: 'stub-offer' };
    }
    async setLocalDescription() {}
    close() {}
  };

  manager.selfId = 'self-id';
  manager.socket = globalThis.io();
  manager.peerConnection = null;
  manager.pendingPeerConnection = null;
  globalThis.document.getElementById('partner-id-field').value = 'peer-1';

  globalThis.requestAnimationFrame = (cb) => {
    manager.connectionAttemptId++;
    cb();
  };

  await manager.initiateConnection();
  if (manager.newConnTimer) clearTimeout(manager.newConnTimer);

  assert.equal(
    peerConnectionsCreated,
    0,
    'a superseded attempt must not create a peer connection',
  );
  assert.equal(manager.pendingPeerConnection, null);
});
