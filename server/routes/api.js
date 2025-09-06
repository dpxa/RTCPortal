const express = require("express");
const router = express.Router();

// TURN credentials endpoint
router.get("/turn-credentials", async (req, res) => {
  const fetch = (await import("node-fetch")).default;
  const apiKey = process.env.METERED_API_KEY;

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "API key not configured on the server." });
  }

  const meteredApiUrl = `https://rtcportal.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;

  try {
    const response = await fetch(meteredApiUrl);
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: "Failed to fetch TURN credentials from Metered API.",
        details: errorText,
      });
    }
    const iceServers = await response.json();
    res.status(200).json(iceServers);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Server error while fetching TURN credentials." });
  }
});

// Connection statistics endpoint
router.get("/connection-stats", (req, res) => {
  const connectionStats = req.app.get("connectionStats");

  const successRate =
    connectionStats.totalAttempts > 0
      ? (
          (connectionStats.successfulConnections /
            connectionStats.totalAttempts) *
          100
        ).toFixed(1)
      : "0.0";

  const uptimeHours = (
    (Date.now() - connectionStats.startTime) /
    (1000 * 60 * 60)
  ).toFixed(1);

  res.status(200).json({
    successRate: parseFloat(successRate),
    uptimeHours: parseFloat(uptimeHours),
  });
});

module.exports = router;
