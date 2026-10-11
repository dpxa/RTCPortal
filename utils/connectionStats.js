class ConnectionStats {
  constructor() {
    this.totalAttempts = 0;
    this.successfulConnections = 0;
    this.startTime = Date.now();
    this.totalBytesTransferred = 0;
    this.totalFilesTransferred = 0;
    this.ipBandwidth = new Map();
  }

  incrementAttempts() {
    this.totalAttempts++;
  }

  incrementSuccesses() {
    if (this.successfulConnections < this.totalAttempts) {
      this.successfulConnections++;
    }
  }

  decrementAttempts() {
    if (this.totalAttempts > 0) {
      this.totalAttempts--;
      if (this.successfulConnections > this.totalAttempts) {
        this.successfulConnections = this.totalAttempts;
      }
    }
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
    const safeAttempts = Math.max(0, this.totalAttempts);
    const safeSuccesses = Math.max(
      0,
      Math.min(this.successfulConnections, safeAttempts),
    );
    const successRate =
      safeAttempts > 0
        ? ((safeSuccesses / safeAttempts) * 100).toFixed(1)
        : "0.0";

    const uptimeMs = Date.now() - this.startTime;

    return {
      successRate: parseFloat(successRate),
      uptimeMs: uptimeMs,
      totalBytesTransferred: this.totalBytesTransferred,
      totalFilesTransferred: this.totalFilesTransferred,
    };
  }
}

module.exports = new ConnectionStats();
