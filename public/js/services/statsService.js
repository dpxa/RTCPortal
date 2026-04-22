class StatsService {
  constructor() {
    this.fetchInFlight = null;
    this.lastSuccessfulFetchAt = 0;
    this.fetchCooldownMs = 1200;

    this.requestConnectionStats({ force: true });
    setInterval(() => {
      this.requestConnectionStats();
    }, STATS_FETCH_INTERVAL);
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

  async fetchConnectionStats(options = {}) {
    return this.requestConnectionStats(options);
  }

  async _fetchAndRender() {
    try {
      const response = await fetch(
        `${BASE_API_URL}${API_ENDPOINTS.CONNECTION_STATS}`,
      );

      if (!response.ok) {
        let errorMessage = `Failed to fetch stats: ${response.status} ${response.statusText}.`;
        try {
          const errorData = await response.json();
          errorMessage += ` ${errorData.details || errorData.error || ""}`;
        } catch (error) {}
        throw new Error(errorMessage);
      }

      const stats = await response.json();
      this.lastSuccessfulFetchAt = Date.now();
      uiManager.updateConnectionStats(stats);
    } catch (error) {
      console.error("Error fetching connection stats:", error.message || error);
      uiManager.showConnectionStatsError();
    }
  }
}

const statsService = new StatsService();
