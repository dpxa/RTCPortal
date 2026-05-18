const express = require("express");
const crypto = require("crypto");
const {
  METERED_API_BASE_URL,
  HTTP_STATUS,
  API_ENDPOINTS,
} = require("../config/constants");
const router = express.Router();

const sendError = (res, status, error) => res.status(status).json({ error });

const TURN_TOKEN_SECRET = process.env.TURN_TOKEN_SECRET || null;
const TURN_TOKEN_TTL_MS = 60000;

const generateTurnToken = () => {
  if (!TURN_TOKEN_SECRET) return null;
  const expiresAt = Date.now() + TURN_TOKEN_TTL_MS;
  const payload = `${expiresAt}`;
  const signature = crypto
    .createHmac("sha256", TURN_TOKEN_SECRET)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
};

const isAuthorizedTurnRequest = (req) => {
  if (!TURN_TOKEN_SECRET) return false;

  const authHeader = req.get("Authorization") || "";
  let token = req.query.token || null;
  if (!token && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  if (!token) return false;

  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return false;

  const expiresAtStr = token.slice(0, dotIndex);
  const providedSig = token.slice(dotIndex + 1);

  const expectedSig = crypto
    .createHmac("sha256", TURN_TOKEN_SECRET)
    .update(expiresAtStr)
    .digest("hex");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(providedSig, "hex"),
      Buffer.from(expectedSig, "hex"),
    )
  ) {
    return false;
  }

  const expiresAt = parseInt(expiresAtStr, 10);
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
};

router.get(API_ENDPOINTS.TURN_TOKEN, (req, res) => {
  const token = generateTurnToken();
  if (!token) {
    return sendError(
      res,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "TURN token service not configured",
    );
  }
  res.status(HTTP_STATUS.OK).json({ token, expiresIn: TURN_TOKEN_TTL_MS });
});

router.get(API_ENDPOINTS.TURN_CREDENTIALS, async (req, res) => {
  if (!isAuthorizedTurnRequest(req)) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      "Forbidden - Invalid or expired access token",
    );
  }

  try {
    const fetch = (await import("node-fetch")).default;
    const apiKey = process.env.METERED_API_KEY;

    if (!apiKey) {
      return sendError(
        res,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        "API key not configured on the server.",
      );
    }

    const meteredApiUrl = `${METERED_API_BASE_URL}/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
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

router.get(API_ENDPOINTS.CONNECTION_STATS, (req, res) => {
  const connectionStats = req.app.get("connectionStats");
  res.status(HTTP_STATUS.OK).json(connectionStats.getStats());
});

module.exports = router;
