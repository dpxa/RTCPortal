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

test('main.js loads without errors', async () => {
  const mod = await bundleModule(
    path.join(PUBLIC_JS, 'main.js'),
    bundleDir,
  );
  assert.ok(mod);
});
