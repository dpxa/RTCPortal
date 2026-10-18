const ATTEMPT_OUTCOME_SUCCESS = "success";

class ConnectionStats {
  constructor() {
    this.startTime = Date.now();
    this.totalBytesTransferred = 0;
    this.totalFilesTransferred = 0;
    this.ipBandwidth = new Map();
    this.resetAttemptCounters();
  }

  resetAttemptCounters() {
    this.totalConnectionAttempts = 0;
    this.successfulConnections = 0;
    this.failedConnections = 0;
    this.pendingAttemptIds = new Set();
  }

  _normalizeAttemptId(attemptId) {
    if (attemptId === null || attemptId === undefined) return null;

    const key = String(attemptId);
    if (key.length === 0 || key.length > 128) return null;

    return key;
  }

  beginAttempt(attemptId) {
    const key = this._normalizeAttemptId(attemptId);
    if (key === null || this.pendingAttemptIds.has(key)) return false;

    this.totalConnectionAttempts++;
    this.pendingAttemptIds.add(key);
    return true;
  }

  completeAttempt(outcome, attemptId) {
    const key = this._normalizeAttemptId(attemptId);
    if (key === null || !this.pendingAttemptIds.delete(key)) return false;

    if (outcome === ATTEMPT_OUTCOME_SUCCESS) {
      this.successfulConnections++;
    } else {
      this.failedConnections++;
    }

    return true;
  }

  releaseAttempt(attemptId) {
    const key = this._normalizeAttemptId(attemptId);
    if (key === null || !this.pendingAttemptIds.delete(key)) return false;

    this.failedConnections++;
    return true;
  }

  addTransfer(bytes, fileCount = 1) {
    const safeBytes = Number(bytes);
    const safeFileCount = Number(fileCount);

    if (Number.isFinite(safeBytes) && safeBytes > 0) {
      this.totalBytesTransferred += Math.round(safeBytes);
    }

    if (Number.isFinite(safeFileCount) && safeFileCount > 0) {
      this.totalFilesTransferred += Math.floor(safeFileCount);
    }
  }

  addIpBandwidth(ip, bytes) {
    if (!ip || !Number.isFinite(bytes) || bytes <= 0) return;
    const current = this.ipBandwidth.get(ip) || 0;
    this.ipBandwidth.set(ip, current + Math.round(bytes));
    if (this.ipBandwidth.size > 10000) {
      const oldestIp = this.ipBandwidth.keys().next().value;
      this.ipBandwidth.delete(oldestIp);
    }
  }

  getIpBandwidth(ip) {
    return this.ipBandwidth.get(ip) || 0;
  }

  isIpOverQuota(ip, quotaBytes) {
    if (!ip || !quotaBytes || quotaBytes <= 0) return false;
    return this.getIpBandwidth(ip) >= quotaBytes;
  }

  getGlobalBandwidth() {
    let total = 0;
    for (const bytes of this.ipBandwidth.values()) {
      total += bytes;
    }
    return total;
  }

  isGlobalOverQuota(quotaBytes) {
    if (!quotaBytes || quotaBytes <= 0) return false;
    return this.getGlobalBandwidth() >= quotaBytes;
  }

  getStats() {
    const resolved = this.successfulConnections + this.failedConnections;
    const successRate =
      resolved > 0
        ? ((this.successfulConnections / resolved) * 100).toFixed(1)
        : "0.0";

    const uptimeMs = Date.now() - this.startTime;

    return {
      successRate: parseFloat(successRate),
      uptimeMs: uptimeMs,
      totalBytesTransferred: this.totalBytesTransferred,
      totalFilesTransferred: this.totalFilesTransferred,
      totalConnectionAttempts: this.totalConnectionAttempts,
      successfulConnections: this.successfulConnections,
      failedConnections: this.failedConnections,
      resolvedConnections: resolved,
    };
  }
}

module.exports = new ConnectionStats();
