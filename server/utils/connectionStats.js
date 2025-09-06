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

    const uptimeHours = (
      (Date.now() - this.startTime) /
      (1000 * 60 * 60)
    ).toFixed(1);

    return {
      successRate: parseFloat(successRate),
      uptimeHours: parseFloat(uptimeHours),
      totalAttempts: this.totalAttempts,
      successfulConnections: this.successfulConnections,
    };
  }
}

module.exports = new ConnectionStats();
