class TurnService {
  constructor() {
    this.rtcConfig = { ...RTC_CONFIG };
    this.initializeTurnCredentials();
  }

  async initializeTurnCredentials() {
    try {
      const apiUrl = `${BASE_API_URL}/api/turn-credentials`;
      const response = await fetch(apiUrl);

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Failed to parse error response." }));
        throw new Error(
          `Failed to fetch TURN credentials: ${response.status} ${
            response.statusText
          }. ${errorData.details || errorData.error}`
        );
      }

      const turnServers = await response.json();

      if (turnServers && Array.isArray(turnServers) && turnServers.length > 0) {
        this.rtcConfig.iceServers = this.rtcConfig.iceServers.concat(turnServers);
      } else {
        console.warn("Using default STUN servers only.");
      }
    } catch (error) {
      console.error("Using default STUN servers only.", error);
    }
  }

  getRtcConfig() {
    return this.rtcConfig;
  }
}

const turnService = new TurnService();
