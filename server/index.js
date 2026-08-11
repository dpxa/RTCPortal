const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const apiRoutes = require("./routes/api");
const connectionStats = require("./utils/connectionStats");
const { handleSocketConnection } = require("./socket/handlers");
const {
  HTTP_STATUS,
  ROUTES,
  RATE_LIMIT,
  API_ENDPOINTS,
  STATS_RATE_LIMIT,
} = require("./config/constants");

const environment = process.env.NODE_ENV || "development";
const isProd = environment === "production";
const config = require(`./config/${environment}`);

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = socketIO(server, {
  transports: config.transports,
  cors: {
    origin: config.cors,
    methods: ["GET", "POST"],
  },
});

if (isProd) {
  app.use(
    require("cors")({
      origin: config.cors,
      optionsSuccessStatus: HTTP_STATUS.OK,
    }),
  );
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": [
          "'self'",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net",
        ],
        "style-src": [
          "'self'",
          "https://fonts.googleapis.com",
          "'unsafe-inline'",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'"],
      },
    },
  }),
);

app.set("connectionStats", connectionStats);

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: isProd
    ? RATE_LIMIT.MAX_API_REQUESTS_PROD
    : RATE_LIMIT.MAX_API_REQUESTS_DEV,
  message: { error: RATE_LIMIT.MESSAGES.API_LIMIT },
  standardHeaders: true,
  legacyHeaders: false,
});

const turnLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: isProd
    ? RATE_LIMIT.MAX_TURN_REQUESTS_PROD
    : RATE_LIMIT.MAX_TURN_REQUESTS_DEV,
  message: {
    error: RATE_LIMIT.MESSAGES.TURN_LIMIT,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const turnTokenLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: isProd
    ? RATE_LIMIT.MAX_TURN_TOKEN_REQUESTS_PROD
    : RATE_LIMIT.MAX_TURN_TOKEN_REQUESTS_DEV,
  message: {
    error: RATE_LIMIT.MESSAGES.TURN_TOKEN_LIMIT,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

if (!isProd) {
  app.use(express.static("public"));
}

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
    environment: environment,
  });
});



// NOTE: TURN credential/token limiters are applied per-path inside the
// ROUTES.API router middleware below. Applying them here as well would
// consume two tokens per request (halving the effective limit), so they
// are intentionally NOT registered a second time.

// Stats endpoint rate limiter (token bucket, per-IP)
const statsBuckets = new Map();
const STATS_BUCKET_MAX_SIZE = 10000;
setInterval(() => {
  if (statsBuckets.size === 0) return;
  const now = Date.now();
  const cutoff = now - STATS_RATE_LIMIT.windowMs * 2;
  for (const [ip, bucket] of statsBuckets) {
    if (bucket.lastRefill < cutoff) statsBuckets.delete(ip);
  }
}, 60000);

const statsRateLimiter = (req, res, next) => {
  const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
  let bucket = statsBuckets.get(clientIp);
  if (!bucket) {
    if (statsBuckets.size >= STATS_BUCKET_MAX_SIZE) {
      const oldestKey = statsBuckets.keys().next().value;
      if (oldestKey) statsBuckets.delete(oldestKey);
    }
    bucket = { tokens: STATS_RATE_LIMIT.maxRequests, lastRefill: Date.now() };
    statsBuckets.set(clientIp, bucket);
  }
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  if (elapsed > 0) {
    bucket.tokens = Math.min(
      STATS_RATE_LIMIT.maxRequests,
      bucket.tokens +
        elapsed *
          (STATS_RATE_LIMIT.maxRequests / (STATS_RATE_LIMIT.windowMs / 1000)),
    );
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) {
    return res.status(429).json({
      error: "Too many stats requests. Please wait before refreshing.",
    });
  }
  bucket.tokens -= 1;
  next();
};

app.use(
  ROUTES.API,
  (req, res, next) => {
    if (req.path === API_ENDPOINTS.CONNECTION_STATS) {
      return statsRateLimiter(req, res, next);
    }
    if (req.path === API_ENDPOINTS.TURN_CREDENTIALS) {
      return turnLimiter(req, res, next);
    }
    if (req.path === API_ENDPOINTS.TURN_TOKEN) {
      return turnTokenLimiter(req, res, next);
    }
    return apiLimiter(req, res, next);
  },
  apiRoutes,
);

app.use(ROUTES.API, (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

app.use(ROUTES.API, (err, req, res, _next) => {
  console.error("API Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const SOCKET_RATE_LIMIT = {
  maxEvents: isProd ? 30 : 300,
  windowMs: 10000,
};

const socketBuckets = new Map();
const SOCKET_BUCKET_MAX_SIZE = 10000;
const SOCKET_BUCKET_SWEEP_INTERVAL_MS = 60000;

setInterval(() => {
  if (socketBuckets.size === 0) return;
  const now = Date.now();
  const cutoff = now - SOCKET_RATE_LIMIT.windowMs * 2;
  for (const [id, bucket] of socketBuckets) {
    if (bucket.lastRefill < cutoff) {
      socketBuckets.delete(id);
    }
  }
}, SOCKET_BUCKET_SWEEP_INTERVAL_MS);

const getBucket = (socketId) => {
  let bucket = socketBuckets.get(socketId);
  if (!bucket) {
    if (socketBuckets.size >= SOCKET_BUCKET_MAX_SIZE) {
      console.warn(
        "Socket rate-limit bucket map at capacity, evicting oldest entry",
      );
      // Evict the oldest entry to make room, rather than permanently blocking
      const oldestKey = socketBuckets.keys().next().value;
      if (oldestKey) socketBuckets.delete(oldestKey);
    }
    bucket = { tokens: SOCKET_RATE_LIMIT.maxEvents, lastRefill: Date.now() };
    socketBuckets.set(socketId, bucket);
  }
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  if (elapsed > 0) {
    bucket.tokens = Math.min(
      SOCKET_RATE_LIMIT.maxEvents,
      bucket.tokens +
        elapsed *
          (SOCKET_RATE_LIMIT.maxEvents / (SOCKET_RATE_LIMIT.windowMs / 1000)),
    );
    bucket.lastRefill = now;
  }
  return bucket;
};

io.use((socket, next) => {
  const originalOnevent = socket.onevent.bind(socket);
  socket.onevent = (packet) => {
    const eventName = packet.data[0];
    // Never rate-limit Socket.IO internal events — blocking these
    // prevents disconnect/reconnect/heartbeat from working.
    const internalEvents = new Set([
      "connect",
      "disconnect",
      "disconnecting",
      "error",
      "connect_error",
      "connect_timeout",
      "reconnect",
      "reconnect_attempt",
      "reconnect_error",
      "reconnect_failed",
      "ping",
      "pong",
    ]);
    if (!internalEvents.has(eventName)) {
      const bucket = getBucket(socket.id);
      if (bucket.tokens < 1) {
        console.warn(
          `Socket ${socket.id} rate-limited on event "${eventName}"`,
        );
        try {
          socket.emit("rate-limited", { event: eventName });
        } catch (emitErr) {
          console.error("Failed to emit rate-limited notice:", emitErr);
        }
        return;
      }
      bucket.tokens -= 1;
    }
    try {
      originalOnevent(packet);
    } catch (err) {
      console.error(
        `Socket ${socket.id} event handler error on "${eventName}":`,
        err,
      );
    }
  };
  socket.on("disconnect", () => {
    socketBuckets.delete(socket.id);
  });
  next();
});

handleSocketConnection(io, connectionStats);

const PORT = parseInt(process.env.PORT, 10) || config.port;
const HOST = process.env.HOST || config.host;
server.listen(PORT, HOST, () => {
  console.log(
    `Server bound to ${HOST}:${PORT}. Connect in browser with http://localhost:${PORT}`,
  );
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  if (error.code === "EADDRINUSE" || error.code === "EACCES") {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
