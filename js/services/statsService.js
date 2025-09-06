class StatsService {
  constructor() {
    this.successRateDisplay = document.getElementById("success-rate-display");
    this.uptimeDisplay = document.getElementById("uptime-display");
    
    // Start fetching stats
    this.fetchConnectionStats();
    setInterval(() => this.fetchConnectionStats(), STATS_FETCH_INTERVAL);
  }

  async fetchConnectionStats() {
    try {
      const apiUrl = `${BASE_API_URL}/api/connection-stats`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`);
      }

      const stats = await response.json();
      this.updateStatsDisplay(stats);
    } catch (error) {
      console.error("Error fetching connection stats:", error);
      this.showStatsError();
    }
  }

  updateStatsDisplay(stats) {
    this.successRateDisplay.textContent = `${stats.successRate}%`;
    this.uptimeDisplay.textContent = `${stats.uptimeHours} hours`;

    // Color code success rate
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
