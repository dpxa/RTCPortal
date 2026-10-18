const { test } = require("node:test");
const assert = require("node:assert/strict");

const ConnectionStats = require("../../server/utils/connectionStats");

function freshStats() {
  return new ConnectionStats.constructor();
}

test("attempt ids are required for begin/complete/release", () => {
  const invalidIds = [undefined, null, "", "x".repeat(129)];

  for (const invalidId of invalidIds) {
    const stats = freshStats();
    assert.equal(stats.beginAttempt(invalidId), false, `begin ${invalidId}`);
    assert.equal(stats.totalConnectionAttempts, 0);

    stats.beginAttempt(1);
    assert.equal(
      stats.completeAttempt("success", invalidId),
      false,
      `complete ${invalidId}`,
    );
    assert.equal(
      stats.releaseAttempt(invalidId),
      false,
      `release ${invalidId}`,
    );
    assert.equal(stats.successfulConnections, 0);
    assert.equal(stats.failedConnections, 0);

    // The real attempt is untouched and still resolvable by its own id.
    assert.equal(stats.completeAttempt("success", 1), true);
    assert.equal(stats.successfulConnections, 1);
  }
});

test("beginAttempt counts attempts and is idempotent per id", () => {
  const stats = freshStats();
  stats.beginAttempt(1);
  stats.beginAttempt(2);
  assert.equal(stats.totalConnectionAttempts, 2);
  assert.equal(stats.pendingAttemptIds.size, 2);

  assert.equal(stats.beginAttempt(2), false);
  assert.equal(stats.totalConnectionAttempts, 2);
});

test("an id resolves its attempt exactly once, and only if it is known", () => {
  const stats = freshStats();
  stats.beginAttempt(1);
  stats.beginAttempt(2);

  assert.equal(stats.completeAttempt("success", 1), true);
  assert.equal(stats.completeAttempt("success", 1), false);
  assert.equal(stats.successfulConnections, 1);
  assert.equal(stats.pendingAttemptIds.size, 1);

  const unknownIds = [99, "never-started"];
  for (const unknownId of unknownIds) {
    assert.equal(stats.completeAttempt("success", unknownId), false);
    assert.equal(stats.releaseAttempt(unknownId), false);
  }
  assert.equal(stats.successfulConnections, 1);
  assert.equal(stats.failedConnections, 0);
  assert.equal(stats.pendingAttemptIds.size, 1);
});

test("releaseAttempt records an unresolved attempt as a failure", () => {
  const stats = freshStats();
  stats.beginAttempt(1);
  assert.equal(stats.releaseAttempt(1), true);

  assert.equal(stats.failedConnections, 1);
  assert.equal(stats.successfulConnections, 0);
  assert.equal(stats.pendingAttemptIds.size, 0);

  assert.equal(stats.releaseAttempt(1), false);
  assert.equal(stats.failedConnections, 1);
});

test("success rate is derived from resolved attempts only", () => {
  const stats = freshStats();
  assert.equal(stats.getStats().successRate, 0);

  stats.beginAttempt(1);
  assert.equal(stats.getStats().successRate, 0);
  stats.completeAttempt("success", 1);
  assert.equal(stats.getStats().successRate, 100);

  stats.beginAttempt(2);
  assert.equal(stats.getStats().successRate, 100);
  stats.completeAttempt("success", 2);
  assert.equal(stats.getStats().successRate, 100);
});

test("a late failure never lowers the rate below what was already reported", () => {
  const stats = freshStats();
  stats.beginAttempt(1);
  stats.completeAttempt("success", 1);
  assert.equal(stats.getStats().successRate, 100);

  stats.beginAttempt(2);
  stats.beginAttempt(3);
  assert.equal(stats.getStats().successRate, 100);

  stats.completeAttempt("failure", 2);
  stats.releaseAttempt(3);
  assert.equal(stats.getStats().successRate, 33.3);
});

test("a success cannot be retracted by a later failure of another attempt", () => {
  const stats = freshStats();
  stats.beginAttempt(1);
  stats.completeAttempt("success", 1);

  stats.beginAttempt(2);
  stats.completeAttempt("failure", 2);
  const afterFirstFailure = stats.getStats().successRate;
  assert.equal(afterFirstFailure, 50);

  stats.completeAttempt("failure", 2);
  stats.completeAttempt("success", 1);
  assert.equal(stats.getStats().successRate, afterFirstFailure);
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
  stats.addTransfer(-100, 5);
  stats.addTransfer(NaN, 5);
  stats.addTransfer(0, 5);
  stats.addTransfer(100, -2);
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
  stats.beginAttempt(1);
  stats.beginAttempt(2);
  stats.completeAttempt("success", 1);
  stats.completeAttempt("failure", 2);
  stats.addTransfer(1024, 2);
  const result = stats.getStats();
  assert.equal(result.successRate, 50);
  assert.equal(result.totalBytesTransferred, 1024);
  assert.equal(result.totalFilesTransferred, 2);
  assert.equal(result.totalConnectionAttempts, 2);
  assert.equal(result.successfulConnections, 1);
  assert.equal(result.failedConnections, 1);
  assert.equal(result.resolvedConnections, 2);
  assert.equal(typeof result.uptimeMs, "number");
});
