// Service to fetch and display connection statistics from the backend
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
    this.uptimeDisplay.textContent = `${stats.uptimeHours} hours`;

    if (stats.successRate >= 80) {
      this.successRateDisplay.style.color = "#27ae60";
    } else if (stats.successRate >= 60) {
      this.successRateDisplay.style.color = "#f39c12";
    } else {
      this.successRateDisplay.style.color = "#e74c3c";
    }
  }

  showStatsError() {
    this.successRateDisplay.textContent = "Error";
    this.uptimeDisplay.textContent = "Error";
  }
}

const statsService = new StatsService();
