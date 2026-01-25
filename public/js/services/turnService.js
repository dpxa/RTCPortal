class TurnService {
  constructor() {
    this.rtcConfig = { ...RTC_CONFIG };
    this.initializeTurnCredentials();
  }

  async initializeTurnCredentials() {
    try {
      const response = await fetch(`${BASE_API_URL}/api/turn-credentials`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            `Failed to fetch TURN credentials: ${response.status}`,
        );
      }

      const turnServers = await response.json();

      if (Array.isArray(turnServers) && turnServers.length > 0) {
        this.rtcConfig.iceServers =
          this.rtcConfig.iceServers.concat(turnServers);
      } else {
        console.warn("Using default STUN servers only.");
      }
    } catch (error) {
      if (
        error.message &&
        (error.message.includes("403") || error.message.includes("Forbidden"))
      ) {
        console.warn(
          "Using default STUN servers only (TURN credentials access restricted/forbidden).",
        );
      } else {
        console.error(
          "Using default STUN servers only.",
          error.message || error,
        );
      }
    }
  }

  getRtcConfig() {
    return this.rtcConfig;
  }
}

const turnService = new TurnService();
