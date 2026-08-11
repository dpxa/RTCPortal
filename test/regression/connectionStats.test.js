// Regression tests for server/utils/connectionStats.js
//
// Covers the full public API of the ConnectionStats class: attempt/success
// accounting, transfer aggregation, per-IP and global bandwidth quotas, and
// stats reporting. Uses Node's built-in test runner (node:test).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const ConnectionStats = require("../../server/utils/connectionStats");

// The module exports a singleton; clone its shape into a fresh instance for
// isolated tests.
function freshStats() {
  return new ConnectionStats.constructor();
}

test("incrementAttempts increments totalAttempts", () => {
  const stats = freshStats();
  stats.incrementAttempts();
  stats.incrementAttempts();
  assert.equal(stats.totalAttempts, 2);
});

test("incrementSuccesses never exceeds totalAttempts", () => {
  const stats = freshStats();
  stats.incrementAttempts();
  stats.incrementAttempts();
  stats.incrementSuccesses();
  stats.incrementSuccesses();
  stats.incrementSuccesses(); // extra should be clamped
  assert.equal(stats.successfulConnections, 2);
});

test("decrementAttempts never goes below zero", () => {
  const stats = freshStats();
  stats.decrementAttempts();
  assert.equal(stats.totalAttempts, 0);
});

test("decrementAttempts clamps successfulConnections to attempts", () => {
  const stats = freshStats();
  stats.incrementAttempts();
  stats.incrementAttempts();
  stats.incrementSuccesses();
  stats.incrementSuccesses();
  stats.decrementAttempts();
  assert.equal(stats.totalAttempts, 1);
  assert.equal(stats.successfulConnections, 1);
});

test("addTransfer aggregates bytes and file count", () => {
  const stats = freshStats();
  stats.addTransfer(1024, 3);
  stats.addTransfer(2048, 2);
  assert.equal(stats.totalBytesTransferred, 3072);
  assert.equal(stats.totalFilesTransferred, 5);
});

test("addTransfer ignores invalid/negative bytes but keeps valid file counts", () => {
  const stats = freshStats();
  stats.addTransfer(-100, 5); // negative bytes ignored, fileCount kept
  stats.addTransfer(NaN, 5); // NaN bytes ignored, fileCount kept
  stats.addTransfer(0, 5); // zero bytes ignored, fileCount kept
  stats.addTransfer(100, -2); // valid bytes kept, negative fileCount ignored
  assert.equal(stats.totalBytesTransferred, 100);
  assert.equal(stats.totalFilesTransferred, 15);
});

test("addIpBandwidth accumulates per-IP usage", () => {
  const stats = freshStats();
  stats.addIpBandwidth("1.2.3.4", 100);
  stats.addIpBandwidth("1.2.3.4", 50);
  stats.addIpBandwidth("5.6.7.8", 25);
  assert.equal(stats.getIpBandwidth("1.2.3.4"), 150);
  assert.equal(stats.getIpBandwidth("5.6.7.8"), 25);
  assert.equal(stats.getIpBandwidth("9.9.9.9"), 0);
});

test("addIpBandwidth ignores invalid input", () => {
  const stats = freshStats();
  stats.addIpBandwidth(null, 100);
  stats.addIpBandwidth("1.2.3.4", -5);
  stats.addIpBandwidth("1.2.3.4", NaN);
  assert.equal(stats.getIpBandwidth("1.2.3.4"), 0);
});

test("isIpOverQuota returns true only when quota exceeded", () => {
  const stats = freshStats();
  stats.addIpBandwidth("1.2.3.4", 100);
  assert.equal(stats.isIpOverQuota("1.2.3.4", 100), true);
  assert.equal(stats.isIpOverQuota("1.2.3.4", 101), false);
  assert.equal(stats.isIpOverQuota("1.2.3.4", 0), false);
});

test("getGlobalBandwidth sums all IPs", () => {
  const stats = freshStats();
  stats.addIpBandwidth("1.2.3.4", 100);
  stats.addIpBandwidth("5.6.7.8", 200);
  assert.equal(stats.getGlobalBandwidth(), 300);
});

test("isGlobalOverQuota respects quota", () => {
  const stats = freshStats();
  stats.addIpBandwidth("1.2.3.4", 100);
  stats.addIpBandwidth("5.6.7.8", 200);
  assert.equal(stats.isGlobalOverQuota(300), true);
  assert.equal(stats.isGlobalOverQuota(301), false);
  assert.equal(stats.isGlobalOverQuota(0), false);
});

test("getStats reports success rate and totals", () => {
  const stats = freshStats();
  stats.incrementAttempts();
  stats.incrementAttempts();
  stats.incrementSuccesses();
  stats.addTransfer(1024, 2);
  const result = stats.getStats();
  assert.equal(result.successRate, 50);
  assert.equal(result.totalBytesTransferred, 1024);
  assert.equal(result.totalFilesTransferred, 2);
  assert.equal(typeof result.uptimeMs, "number");
});

test("getStats returns 0.0 success rate with no attempts", () => {
  const stats = freshStats();
  const result = stats.getStats();
  assert.equal(result.successRate, 0);
});
