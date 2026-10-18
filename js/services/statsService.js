import { uiManager } from "../ui/uiManager.js";
import {
  BASE_API_URL,
  API_ENDPOINTS,
  STATS_FETCH_INTERVAL,
} from "../config/constants.js";
import { appUtils } from "../utils/commonUtils.js";
class StatsService {
  constructor() {
    this.fetchInFlight = null;
    this.statsIntervalId = null;
    this.hasStats = false;
    this.pushSeq = 0;

    this.requestConnectionStats();
    this.statsIntervalId = setInterval(
      () => this.requestConnectionStats(),
      STATS_FETCH_INTERVAL,
    );

    if (uiManager && typeof uiManager.registerPageExitHandler === "function") {
      uiManager.registerPageExitHandler(() => this.cleanup());
    }
  }

  requestConnectionStats() {
    if (this.fetchInFlight) return this.fetchInFlight;

    this.fetchInFlight = this._fetchAndRender().finally(() => {
      this.fetchInFlight = null;
    });

    return this.fetchInFlight;
  }

  async _fetchAndRender() {
    const seqAtStart = this.pushSeq;

    try {
      const stats = await appUtils.requestJson(
        `${BASE_API_URL}${API_ENDPOINTS.CONNECTION_STATS}`,
        { errorPrefix: "Failed to fetch stats" },
      );
      if (seqAtStart !== this.pushSeq) return;

      this._render(stats);
    } catch (error) {
      console.error("Error fetching connection stats:", error.message || error);
      if (!this.hasStats) {
        uiManager.showConnectionStatsError();
      }
    }
  }

  applyStats(stats) {
    if (!stats || typeof stats !== "object") return;

    this.pushSeq++;
    this._render(stats);
  }

  _render(stats) {
    if (!stats || typeof stats !== "object") return;

    this.hasStats = true;
    uiManager.updateConnectionStats(stats);
  }

  cleanup() {
    if (this.statsIntervalId) {
      clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }

    this.fetchInFlight = null;
  }
}

export const statsService = new StatsService();
