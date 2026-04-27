class ConnectionStats {
  constructor() {
    this.totalAttempts = 0;
    this.successfulConnections = 0;
    this.startTime = Date.now();
    this.totalBytesTransferred = 0;
    this.totalFilesTransferred = 0;
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

  getStats() {
    const successRate =
      this.totalAttempts > 0
        ? ((this.successfulConnections / this.totalAttempts) * 100).toFixed(1)
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
