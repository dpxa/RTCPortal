const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getClientIp } = require("../../server/utils/clientIp");

test("getClientIp prefers Cloudflare cf-connecting-ip header", () => {
  const req = {
    headers: { "cf-connecting-ip": "203.0.113.5" },
    ip: "10.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(getClientIp(req), "203.0.113.5");
});

test("getClientIp trims whitespace from cf-connecting-ip", () => {
  const req = {
    headers: { "cf-connecting-ip": "  203.0.113.5  " },
    ip: "10.0.0.1",
  };
  assert.equal(getClientIp(req), "203.0.113.5");
});

test("getClientIp ignores a client-supplied X-Forwarded-For header", () => {
  const req = {
    headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.5" },
    ip: "203.0.113.5",
  };
  assert.equal(getClientIp(req), "203.0.113.5");
});

test("getClientIp falls back to req.ip when no cf header is present", () => {
  const req = { headers: {}, ip: "198.51.100.7" };
  assert.equal(getClientIp(req), "198.51.100.7");
});

test("getClientIp falls back to socket.remoteAddress when req.ip is absent", () => {
  const req = { headers: {}, socket: { remoteAddress: "198.51.100.9" } };
  assert.equal(getClientIp(req), "198.51.100.9");
});

test("getClientIp ignores blank cf-connecting-ip and uses req.ip", () => {
  const req = { headers: { "cf-connecting-ip": "   " }, ip: "198.51.100.7" };
  assert.equal(getClientIp(req), "198.51.100.7");
});

test("getClientIp returns 'unknown' for null/undefined input", () => {
  assert.equal(getClientIp(null), "unknown");
  assert.equal(getClientIp(undefined), "unknown");
});

test("getClientIp returns 'unknown' when no IP source is available", () => {
  assert.equal(getClientIp({ headers: {} }), "unknown");
});
