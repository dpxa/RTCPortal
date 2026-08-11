const express = require("express");
const crypto = require("crypto");
const {
  METERED_API_BASE_URL,
  HTTP_STATUS,
  API_ENDPOINTS,
  PER_IP_BANDWIDTH_QUOTA_BYTES,
  GLOBAL_BANDWIDTH_QUOTA_BYTES,
} = require("../config/constants");
const router = express.Router();

const sendError = (res, status, error) => res.status(status).json({ error });

const isProd = process.env.NODE_ENV === "production";
const TURN_TOKEN_SECRET = process.env.TURN_TOKEN_SECRET || null;

if (isProd && !TURN_TOKEN_SECRET) {
  console.error(
    "FATAL: TURN_TOKEN_SECRET environment variable is not set. TURN relay will be unavailable.",
  );
}

const TURN_TOKEN_TTL_MS = 300000;

const generateTurnToken = (clientIp) => {
  if (!TURN_TOKEN_SECRET) return null;
  const expiresAt = Date.now() + TURN_TOKEN_TTL_MS;
  const payload = `${expiresAt}:${clientIp}`;
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

  const payload = token.slice(0, dotIndex);
  const providedSig = token.slice(dotIndex + 1);

  const expectedSig = crypto
    .createHmac("sha256", TURN_TOKEN_SECRET)
    .update(payload)
    .digest("hex");

  let providedBuf;
  let expectedBuf;
  try {
    providedBuf = Buffer.from(providedSig, "hex");
    expectedBuf = Buffer.from(expectedSig, "hex");
  } catch {
    return false;
  }
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return false;
  }

  const colonIndex = payload.indexOf(":");
  if (colonIndex === -1) return false;

  const expiresAtStr = payload.slice(0, colonIndex);
  const clientIp = payload.slice(colonIndex + 1);
  const requestIp = req.ip || req.socket?.remoteAddress || "unknown";

  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  return clientIp === requestIp;
};

router.get(API_ENDPOINTS.TURN_TOKEN, (req, res) => {
  const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
  const connectionStats = req.app.get("connectionStats");

  if (
    PER_IP_BANDWIDTH_QUOTA_BYTES > 0 &&
    connectionStats.isIpOverQuota(clientIp, PER_IP_BANDWIDTH_QUOTA_BYTES)
  ) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      "Your TURN bandwidth quota has been exhausted. TURN access disabled.",
    );
  }

  // Global pool check: only block IPs that have already used some TURN bandwidth.
  // Brand-new users (zero usage) can always connect so the system stays usable
  // even when the pool is nearly exhausted.
  if (
    GLOBAL_BANDWIDTH_QUOTA_BYTES > 0 &&
    connectionStats.getIpBandwidth(clientIp) > 0 &&
    connectionStats.isGlobalOverQuota(GLOBAL_BANDWIDTH_QUOTA_BYTES)
  ) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      "TURN server capacity reached. Please try again later.",
    );
  }

  const token = generateTurnToken(clientIp);
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
  const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
  const connectionStats = req.app.get("connectionStats");

  if (
    PER_IP_BANDWIDTH_QUOTA_BYTES > 0 &&
    connectionStats.isIpOverQuota(clientIp, PER_IP_BANDWIDTH_QUOTA_BYTES)
  ) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      "Your TURN bandwidth quota has been exhausted. TURN access disabled.",
    );
  }

  // Global pool check: only block IPs that have already used some TURN bandwidth.
  if (
    GLOBAL_BANDWIDTH_QUOTA_BYTES > 0 &&
    connectionStats.getIpBandwidth(clientIp) > 0 &&
    connectionStats.isGlobalOverQuota(GLOBAL_BANDWIDTH_QUOTA_BYTES)
  ) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      "TURN server capacity reached. Please try again later.",
    );
  }

  if (!isAuthorizedTurnRequest(req)) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      "Forbidden - Invalid or expired access token",
    );
  }

  try {
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
  const stats = connectionStats.getStats();
  stats.perIpBandwidthQuotaBytes = PER_IP_BANDWIDTH_QUOTA_BYTES;
  stats.globalBandwidthQuotaBytes = GLOBAL_BANDWIDTH_QUOTA_BYTES;
  stats.globalBandwidthUsedBytes = connectionStats.getGlobalBandwidth();
  res.status(HTTP_STATUS.OK).json(stats);
});

module.exports = router;
