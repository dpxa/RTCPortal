function getClientIp(req) {
  if (!req) return "unknown";

  const cfIp = req.headers?.["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) {
    return cfIp.trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
}

module.exports = { getClientIp };
