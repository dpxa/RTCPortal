const express = require("express");
const {
  CORS_ORIGINS,
  METERED_API_BASE_URL,
  HTTP_STATUS,
} = require("../config/constants");
const router = express.Router();

const sendError = (res, status, error) => res.status(status).json({ error });
const isFromGitHubPages = (referer, origin) =>
  referer?.startsWith(CORS_ORIGINS.GITHUB_PAGES) ||
  origin?.startsWith(CORS_ORIGINS.GITHUB_PAGES);

router.get("/turn-credentials", async (req, res) => {
  const referer = req.get("Referer");
  const origin = req.get("Origin");

  if (!isFromGitHubPages(referer, origin)) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      "Forbidden - Access restricted",
    );
  }

  const fetch = (await import("node-fetch")).default;
  const apiKey = process.env.METERED_API_KEY;

  if (!apiKey) {
    return sendError(
      res,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "API key not configured on the server.",
    );
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
      return sendError(res, response.status, errorMsg);
    }

    const turnServers = await response.json();

    if (Array.isArray(turnServers) && turnServers.length > 0) {
      return res.status(HTTP_STATUS.OK).json(turnServers);
    } else {
      return res.status(HTTP_STATUS.OK).json([]);
    }
  } catch (error) {
    return sendError(
      res,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      `Server error while fetching TURN credentials. ${error.message || error}`,
    );
  }
});

router.get("/connection-stats", (req, res) => {
  const connectionStats = req.app.get("connectionStats");
  res.status(HTTP_STATUS.OK).json(connectionStats.getStats());
});

module.exports = router;
