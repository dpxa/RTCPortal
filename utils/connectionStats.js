class ConnectionStats {
  constructor() {
    this.totalAttempts = 0;
    this.successfulConnections = 0;
    this.startTime = Date.now();
  }

  incrementAttempts() {
    this.totalAttempts++;
  }

  incrementSuccesses() {
    this.successfulConnections++;
  }

  decrementAttempts() {
    if (this.totalAttempts > 0) {
      this.totalAttempts--;
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
    };
  }
}

module.exports = new ConnectionStats();
