import {
  environmentIsProd,
  BASE_API_URL,
  API_ENDPOINTS,
  RTC_CONFIG,
} from "../config/constants.js";
import { appUtils } from "../utils/commonUtils.js";

class TurnService {
  constructor() {
    this.rtcConfig = { ...RTC_CONFIG };
    this._token = null;
    this._tokenExpiresAt = 0;
    this._tokenTtlMs = 240000;
    this._ready = this.initializeTurnCredentials();
  }

  async initializeTurnCredentials() {
    if (!environmentIsProd) {
      console.log("Development mode: Using STUN servers only (no TURN)");
      return;
    }

    await this._refreshTurnCredentials();
  }

  async _refreshTurnCredentials() {

    if (this._refreshPromise) {
      return this._refreshPromise;
    }
    this._refreshPromise = (async () => {
      try {
        const { token, expiresIn } = await appUtils.requestJson(
          `${BASE_API_URL}${API_ENDPOINTS.TURN_TOKEN}`,
          { errorPrefix: "Failed to fetch TURN access token" },
        );

        if (!token || typeof token !== "string") {
          throw new Error("Invalid token response from server");
        }

        this._token = token;
        this._tokenTtlMs = Number(expiresIn) || 300000;
        this._tokenExpiresAt = Date.now() + this._tokenTtlMs;

        const turnServers = await appUtils.requestJson(
          `${BASE_API_URL}${API_ENDPOINTS.TURN_CREDENTIALS}?token=${encodeURIComponent(token)}`,
          { errorPrefix: "Failed to fetch TURN credentials" },
        );

        if (Array.isArray(turnServers) && turnServers.length > 0) {
          this.rtcConfig.iceServers = [
            ...RTC_CONFIG.iceServers,
            ...turnServers,
          ];
          console.log(`TURN servers added: ${turnServers.length} server(s)`);
        } else {
          console.warn("Using default STUN servers only.");
        }
      } catch (refreshError) {
        console.warn(
          "Could not retrieve premium TURN servers. Using default STUN servers only.",
          refreshError,
        );

        this._tokenExpiresAt = 0;
      } finally {
        this._refreshPromise = null;
      }
    })();
    return this._refreshPromise;
  }

  async _ensureTokenFresh() {
    if (!environmentIsProd) return;
    if (!this._token || Date.now() >= this._tokenExpiresAt - 30000) {
      await this._refreshTurnCredentials();
    }
  }

  async awaitReady() {
    await this._ready;
    await this._ensureTokenFresh();
  }

  getRtcConfig() {
    return this.rtcConfig;
  }
}

export const turnService = new TurnService();
