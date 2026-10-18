import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  bundleModule,
  createBundleDir,
  PUBLIC_JS,
} from './helpers/bundle-client-module.mjs';
import {
  setupJSDOMEnv,
  teardownJSDOMEnv,
} from './helpers/setup-jsdom-env.mjs';

const MAX_RECEIVE_BATCH_SIZE = 2 * 1024 * 1024 * 1024;

let bundleDir;

beforeEach(async () => {
  setupJSDOMEnv();
  bundleDir = createBundleDir();
});

afterEach(() => {
  teardownJSDOMEnv();
});

async function loadManager() {
  const mod = await bundleModule(
    path.join(PUBLIC_JS, 'core/fileTransferManager.js'),
    bundleDir,
  );
  assert.ok(mod.fileTransferManager, 'fileTransferManager must be exported');
  return mod.fileTransferManager;
}

function validMetadata(overrides = {}) {
  return {
    type: 'metadata',
    fileName: 'report.txt',
    fileSize: 1024,
    batchIndex: 1,
    batchTotal: 1,
    ...overrides,
  };
}

test('core/fileTransferManager.js exposes the transfer manager singleton', async () => {
  const manager = await loadManager();
  assert.equal(typeof manager._isValidMetadataPayload, 'function');
  assert.equal(typeof manager.processControlInstruction, 'function');
});

test('the metadata validator accepts a well-formed payload', async () => {
  const manager = await loadManager();
  assert.equal(manager._isValidMetadataPayload(validMetadata()), true);
});

test('the metadata validator accepts optional fields when well-formed', async () => {
  const manager = await loadManager();
  assert.equal(
    manager._isValidMetadataPayload(
      validMetadata({
        sha256: 'a'.repeat(64),
        totalBatchSize: 4096,
        resumeOffset: 0,
      }),
    ),
    true,
  );

  assert.equal(
    manager._isValidMetadataPayload(
      validMetadata({ sha256: null, totalBatchSize: null }),
    ),
    true,
  );
});

test('the metadata validator rejects a payload without the metadata type', async () => {
  const manager = await loadManager();
  assert.equal(manager._isValidMetadataPayload(null), false);
  assert.equal(manager._isValidMetadataPayload(undefined), false);
  assert.equal(manager._isValidMetadataPayload({}), false);
  assert.equal(
    manager._isValidMetadataPayload(validMetadata({ type: 'chunk' })),
    false,
  );
});

test('the metadata validator rejects path traversal, null bytes and absolute paths', async () => {
  const manager = await loadManager();
  const hostileNames = [
    '../etc/passwd',
    '..\\windows\\system32',
    'nested/../../escape.txt',
    'null\u0000byte.txt',
    '/absolute/path.txt',
    '\\absolute\\path.txt',
  ];

  for (const fileName of hostileNames) {
    assert.equal(
      manager._isValidMetadataPayload(validMetadata({ fileName })),
      false,
      `expected rejection for ${JSON.stringify(fileName)}`,
    );
  }
});

test('the metadata validator rejects empty, non-string and oversized file names', async () => {
  const manager = await loadManager();
  const badNames = ['', '   ', 'x'.repeat(1025), 42, null, undefined, {}];

  for (const fileName of badNames) {
    assert.equal(
      manager._isValidMetadataPayload(validMetadata({ fileName })),
      false,
      `expected rejection for ${JSON.stringify(fileName)}`,
    );
  }

  assert.equal(
    manager._isValidMetadataPayload(validMetadata({ fileName: 'x'.repeat(1024) })),
    true,
    'a 1024-character name is within the limit',
  );
});

test('the metadata validator enforces file size bounds', async () => {
  const manager = await loadManager();
  const badSizes = [
    -1,
    NaN,
    Infinity,
    '1024',
    null,
    undefined,
    MAX_RECEIVE_BATCH_SIZE + 1,
  ];

  for (const fileSize of badSizes) {
    assert.equal(
      manager._isValidMetadataPayload(validMetadata({ fileSize })),
      false,
      `expected rejection for fileSize ${String(fileSize)}`,
    );
  }

  assert.equal(
    manager._isValidMetadataPayload(validMetadata({ fileSize: 0 })),
    true,
  );
  assert.equal(
    manager._isValidMetadataPayload(
      validMetadata({ fileSize: MAX_RECEIVE_BATCH_SIZE }),
    ),
    true,
  );
});

test('the metadata validator enforces batch index and total bounds', async () => {
  const manager = await loadManager();
  const badBatches = [
    { batchIndex: 0 },
    { batchIndex: -1 },
    { batchIndex: 1.5 },
    { batchIndex: '1' },
    { batchTotal: 0 },
    { batchIndex: 5, batchTotal: 2 },
    { batchTotal: 10001 },
  ];

  for (const overrides of badBatches) {
    assert.equal(
      manager._isValidMetadataPayload(validMetadata(overrides)),
      false,
      `expected rejection for ${JSON.stringify(overrides)}`,
    );
  }

  assert.equal(
    manager._isValidMetadataPayload(
      validMetadata({ batchIndex: 2, batchTotal: 3 }),
    ),
    true,
  );
});

test('the metadata validator only accepts a 64-character lowercase hex sha256', async () => {
  const manager = await loadManager();
  const badHashes = [
    'abc',
    'A'.repeat(64),
    'z'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    12345,
  ];

  for (const sha256 of badHashes) {
    assert.equal(
      manager._isValidMetadataPayload(validMetadata({ sha256 })),
      false,
      `expected rejection for sha256 ${String(sha256).slice(0, 12)}`,
    );
  }
});

test('the metadata validator enforces the total batch size bound', async () => {
  const manager = await loadManager();
  const badTotals = [-1, NaN, '4096', MAX_RECEIVE_BATCH_SIZE + 1];

  for (const totalBatchSize of badTotals) {
    assert.equal(
      manager._isValidMetadataPayload(validMetadata({ totalBatchSize })),
      false,
      `expected rejection for totalBatchSize ${String(totalBatchSize)}`,
    );
  }
});

test('the metadata validator enforces the resume offset bound', async () => {
  const manager = await loadManager();
  const badOffsets = [-1, NaN, MAX_RECEIVE_BATCH_SIZE + 1];

  for (const resumeOffset of badOffsets) {
    assert.equal(
      manager._isValidMetadataPayload(validMetadata({ resumeOffset })),
      false,
      `expected rejection for resumeOffset ${String(resumeOffset)}`,
    );
  }

  assert.equal(
    manager._isValidMetadataPayload(
      validMetadata({ resumeOffset: MAX_RECEIVE_BATCH_SIZE }),
    ),
    true,
  );
});

test('a hostile metadata message is rejected before it reaches the transfer handler', async () => {
  const manager = await loadManager();
  let handled = 0;
  manager.handleIncomingMetadata = async () => {
    handled++;
  };

  await manager.processControlInstruction(
    JSON.stringify(validMetadata({ fileName: '../evil.txt' })),
  );
  assert.equal(handled, 0, 'a traversal payload must never be adopted');

  await manager.processControlInstruction(JSON.stringify(validMetadata()));
  assert.equal(handled, 1, 'the valid payload is adopted');
});

test('malformed control data is contained without throwing', async () => {
  const manager = await loadManager();

  await assert.doesNotReject(async () => {
    await manager.processControlInstruction('{not valid json');
    await manager.processControlInstruction(JSON.stringify({ type: 'metadata' }));
    await manager.processControlInstruction(
      JSON.stringify({ type: 'unknown-instruction' }),
    );
  });
});

test('pause and resume control messages toggle the paused state', async () => {
  const manager = await loadManager();

  await manager.processControlInstruction(
    JSON.stringify({ type: 'pause-transfer' }),
  );
  assert.equal(manager.isPaused, true);
  assert.ok(
    manager.currentPauseStartReceived > 0,
    'pause should record when it started',
  );

  manager.currentPauseStartReceived = Date.now() - 500;

  await manager.processControlInstruction(
    JSON.stringify({ type: 'resume-transfer' }),
  );
  assert.equal(manager.isPaused, false);
  assert.equal(manager.currentPauseStartReceived, 0);
  assert.ok(
    manager.totalPausedTimeReceived >= 500,
    'paused time should be accumulated',
  );
});

test('resume-offset-sync is only honoured while sending with no offset set', async () => {
  const manager = await loadManager();

  manager.isSending = false;
  manager._resumeOffset = null;
  await manager.processControlInstruction(
    JSON.stringify({ type: 'resume-offset-sync', offset: 4096 }),
  );
  assert.equal(manager._resumeOffset, null, 'ignored when not sending');

  manager.isSending = true;
  await manager.processControlInstruction(
    JSON.stringify({ type: 'resume-offset-sync', offset: 4096 }),
  );
  assert.equal(manager._resumeOffset, 4096);

  await manager.processControlInstruction(
    JSON.stringify({ type: 'resume-offset-sync', offset: 8192 }),
  );
  assert.equal(manager._resumeOffset, 4096, 'a second sync must not overwrite');
});

test('resume-offset-sync ignores non-positive and non-numeric offsets', async () => {
  const manager = await loadManager();
  manager.isSending = true;

  for (const offset of [0, -100, 'abc', null, undefined]) {
    manager._resumeOffset = null;
    await manager.processControlInstruction(
      JSON.stringify({ type: 'resume-offset-sync', offset }),
    );
    assert.equal(
      manager._resumeOffset,
      null,
      `offset ${String(offset)} must be ignored`,
    );
  }
});

test('throttle control messages toggle the auto-throttle flag', async () => {
  const manager = await loadManager();

  await manager.processControlInstruction(
    JSON.stringify({ type: 'throttle-pause' }),
  );
  assert.equal(manager.isAutoThrottled, true);

  await manager.processControlInstruction(
    JSON.stringify({ type: 'throttle-resume' }),
  );
  assert.equal(manager.isAutoThrottled, false);
});
