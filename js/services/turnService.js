class TurnService {
  constructor() {
    this.rtcConfig = { ...RTC_CONFIG };
    this.initializeTurnCredentials();
  }

  async initializeTurnCredentials() {
    if (!environmentIsProd) {
      console.log("Development mode: Using STUN servers only (no TURN)");
      return;
    }

    try {
      const { token } = await appUtils.requestJson(
        `${BASE_API_URL}${API_ENDPOINTS.TURN_TOKEN}`,
        { errorPrefix: "Failed to fetch TURN access token" },
      );

      if (!token || typeof token !== "string") {
        throw new Error("Invalid token response from server");
      }

      const turnServers = await appUtils.requestJson(
        `${BASE_API_URL}${API_ENDPOINTS.TURN_CREDENTIALS}?token=${encodeURIComponent(token)}`,
        { errorPrefix: "Failed to fetch TURN credentials" },
      );

      if (Array.isArray(turnServers) && turnServers.length > 0) {
        this.rtcConfig.iceServers =
          this.rtcConfig.iceServers.concat(turnServers);
        console.log(`TURN servers added: ${turnServers.length} server(s)`);
      } else {
        console.warn("Using default STUN servers only.");
      }
    } catch {
      console.warn(
        "Could not retrieve premium TURN servers. Using default STUN servers only.",
      );
    }
  }

  getRtcConfig() {
    return this.rtcConfig;
  }
}

const turnService = new TurnService();
window.turnService = turnService;
