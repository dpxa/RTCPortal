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
      if (this.successfulConnections > this.totalAttempts) {
        this.successfulConnections = this.totalAttempts;
      }
    }
  }

  addTransfer(bytes) {
    if (typeof bytes === "number") {
      this.totalBytesTransferred += bytes;
      this.totalFilesTransferred++;
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
