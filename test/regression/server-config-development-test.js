const { test } = require('node:test');
const assert = require('node:assert/strict');
const devConfig = require('../../server/config/development');

test('development config uses localhost CORS and default port', () => {
  assert.equal(devConfig.port, 3000);
  assert.deepEqual(devConfig.cors, ['http://localhost:3000', 'http://127.0.0.1:3000']);
});
