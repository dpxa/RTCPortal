/**
 * Resolve the real client IP for rate limiting and bandwidth quotas.
 *
 * Production traffic goes client -> Cloudflare -> Render -> app. Express's
 * `req.ip` therefore resolves to a Render-internal address (e.g. 10.x.x.x)
 * rather than the real client, so every user would share one rate-limit
 * bucket. Cloudflare sets `cf-connecting-ip` to the authoritative client
 * address, so prefer that.
 *
 * Note: the raw X-Forwarded-For header is deliberately NOT parsed. Cloudflare
 * APPENDS the client IP, so a client-supplied XFF value would sit first in the
 * list and let an attacker choose their own rate-limit bucket. `req.ip`
 * (which honours `trust proxy`) is used as the fallback instead.
 */
function getClientIp(req) {
  if (!req) return "unknown";

  const cfIp = req.headers?.["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
}

module.exports = { getClientIp };
