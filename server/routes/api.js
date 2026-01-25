const express = require("express");
const {
  CORS_ORIGINS,
  METERED_API_BASE_URL,
  HTTP_STATUS,
} = require("../config/constants");
const router = express.Router();

router.get("/turn-credentials", async (req, res) => {
  const referer = req.get("Referer");
  const origin = req.get("Origin");

  const isFromGitHubPages =
    referer?.startsWith(CORS_ORIGINS.GITHUB_PAGES) ||
    origin?.startsWith(CORS_ORIGINS.GITHUB_PAGES);

  if (!isFromGitHubPages) {
    return res
      .status(HTTP_STATUS.FORBIDDEN)
      .json({ error: "Forbidden - Access restricted" });
  }

  const fetch = (await import("node-fetch")).default;
  const apiKey = process.env.METERED_API_KEY;

  if (!apiKey) {
    return res
      .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      .json({ error: "API key not configured on the server." });
  }

  const meteredApiUrl = `${METERED_API_BASE_URL}/turn/credentials?apiKey=${apiKey}`;

  try {
    const response = await fetch(meteredApiUrl);

    if (!response.ok) {
      let errorMsg = `Failed to fetch TURN credentials: ${response.status} ${response.statusText}.`;
      try {
        const errorData = await response.json();
        errorMsg += ` ${errorData.details || errorData.error || ""}`;
      } catch {}
      return res.status(response.status).json({ error: errorMsg });
    }

    const turnServers = await response.json();

    if (Array.isArray(turnServers) && turnServers.length > 0) {
      return res.status(HTTP_STATUS.OK).json(turnServers);
    } else {
      return res.status(HTTP_STATUS.OK).json([]);
    }
  } catch (error) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: `Server error while fetching TURN credentials. ${
        error.message || error
      }`,
    });
  }
});

router.get("/connection-stats", (req, res) => {
  const connectionStats = req.app.get("connectionStats");
  res.status(HTTP_STATUS.OK).json(connectionStats.getStats());
});

module.exports = router;
