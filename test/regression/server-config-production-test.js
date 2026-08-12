const { test } = require('node:test');
const assert = require('node:assert/strict');
const prodConfig = require('../../server/config/production');

test('production config uses GitHub Pages CORS', () => {
  assert.equal(prodConfig.cors, 'https://dpxa.github.io');
});
