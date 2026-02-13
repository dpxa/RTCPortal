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
    // Prevent successes from exceeding attempts
    if (this.successfulConnections < this.totalAttempts) {
      this.successfulConnections++;
    }
  }

  decrementAttempts() {
    if (this.totalAttempts > 0) {
      this.totalAttempts--;
      // Keep successes within attempts if attempts are decremented.
      if (this.successfulConnections > this.totalAttempts) {
        this.successfulConnections = this.totalAttempts;
      }
    }
  }

  getStats() {
    const successRate =
      this.totalAttempts > 0
        ? Math.min(
            (this.successfulConnections / this.totalAttempts) * 100,
            100,
          ).toFixed(1)
        : "0.0";

    const uptimeMs = Date.now() - this.startTime;

    return {
      successRate: parseFloat(successRate),
      uptimeMs: uptimeMs,
    };
  }
}

module.exports = new ConnectionStats();
