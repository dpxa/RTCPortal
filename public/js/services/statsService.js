class StatsService {
  constructor() {
    this.fetchInFlight = null;
    this.lastSuccessfulFetchAt = 0;
    this.fetchCooldownMs = 1200;
    this.statsIntervalId = null;

    this.requestConnectionStats({ force: true });
    this.statsIntervalId = setInterval(() => {
      this.requestConnectionStats().catch((err) => {
        console.error("Stats fetch failed:", err);
      });
    }, STATS_FETCH_INTERVAL);

    if (
      window.uiManager &&
      typeof uiManager.registerPageExitHandler === "function"
    ) {
      uiManager.registerPageExitHandler(() => this.cleanup());
    }
  }

  async requestConnectionStats(options = {}) {
    const { force = false } = options;

    if (this.fetchInFlight) {
      return this.fetchInFlight;
    }

    if (
      !force &&
      Date.now() - this.lastSuccessfulFetchAt < this.fetchCooldownMs
    ) {
      return;
    }

    this.fetchInFlight = this._fetchAndRender().finally(() => {
      this.fetchInFlight = null;
    });

    return this.fetchInFlight;
  }

  async _fetchAndRender() {
    try {
      const stats = await appUtils.requestJson(
        `${BASE_API_URL}${API_ENDPOINTS.CONNECTION_STATS}`,
        { errorPrefix: "Failed to fetch stats" },
      );
      this.lastSuccessfulFetchAt = Date.now();
      uiManager.updateConnectionStats(stats);
    } catch (error) {
      console.error("Error fetching connection stats:", error.message || error);
      uiManager.showConnectionStatsError();
    }
  }

  cleanup() {
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }

    this.fetchInFlight = null;
  }
}

const statsService = new StatsService();
window.statsService = statsService;
