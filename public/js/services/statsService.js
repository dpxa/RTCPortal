class StatsService {
  constructor() {
    this.successRateDisplay = document.getElementById("success-rate-display");
    this.uptimeDisplay = document.getElementById("uptime-display");

    this.fetchConnectionStats();
    setInterval(() => this.fetchConnectionStats(), STATS_FETCH_INTERVAL);
  }

  async fetchConnectionStats() {
    try {
      const response = await fetch(`${BASE_API_URL}/api/connection-stats`);

      if (!response.ok) {
        let errorMsg = `Failed to fetch stats: ${response.status} ${response.statusText}.`;
        try {
          const errorData = await response.json();
          errorMsg += ` ${errorData.details || errorData.error || ""}`;
        } catch {}
        throw new Error(errorMsg);
      }

      const stats = await response.json();
      this.updateStatsDisplay(stats);
    } catch (error) {
      console.error("Error fetching connection stats:", error.message || error);
      this.showStatsError();
    }
  }

  updateStatsDisplay(stats) {
    this.successRateDisplay.textContent = `${stats.successRate}%`;
    this.uptimeDisplay.textContent = this.formatUptime(stats.uptimeMs);

    this.applySuccessRateColor(stats.successRate);
  }

  applySuccessRateColor(rate) {
    const good = getCssVar("--accent", "#27ae60");
    const warn = getCssVar("--pause-color", "#f39c12");
    const bad = getCssVar("--danger", "#e74c3c");

    if (rate >= 80) this.successRateDisplay.style.color = good;
    else if (rate >= 60) this.successRateDisplay.style.color = warn;
    else this.successRateDisplay.style.color = bad;
  }

  showStatsError() {
    this.successRateDisplay.textContent = "Error";
    this.uptimeDisplay.textContent = "Error";
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days !== 1 ? "s" : ""}`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }
}

const statsService = new StatsService();
