class TurnService {
  constructor() {
    this.rtcConfig = { ...RTC_CONFIG };
    this.initializeTurnCredentials();
  }

  async initializeTurnCredentials() {
    if (!environmentIsProd) {
      console.log(
        "Local environment: Using default STUN servers only. (Skipped TURN fetch)",
      );
      return;
    }

    try {
      const response = await fetch(
        `${BASE_API_URL}${API_ENDPOINTS.TURN_CREDENTIALS}`,
      );

      if (!response.ok) {
        let errorMsg = `Failed to fetch TURN credentials: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error || errorMsg;
        } catch {}
        throw new Error(errorMsg);
      }

      const turnServers = await response.json();

      if (Array.isArray(turnServers) && turnServers.length > 0) {
        this.rtcConfig.iceServers =
          this.rtcConfig.iceServers.concat(turnServers);
      } else {
        console.warn("Using default STUN servers only.");
      }
    } catch (error) {
      console.warn("Could not retrieve premium TURN servers. Using default STUN servers only.");
    }
  }

  getRtcConfig() {
    return this.rtcConfig;
  }
}

const turnService = new TurnService();
