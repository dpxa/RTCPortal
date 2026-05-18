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
} = require("./config/constants");

const environment = process.env.NODE_ENV || "development";
const isProd = environment === "production";
const config = require(`./config/${environment}`);

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = socketIO(server, {
  transports: config.transports,
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
        "script-src": ["'self'", "https://cdnjs.cloudflare.com"],
        "style-src": [
          "'self'",
          "https://fonts.googleapis.com",
          "'unsafe-inline'",
        ],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "blob:"],
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

app.get(ROUTES.TEST, (req, res) => {
  res.status(200).send(`
    <h1>RTC Portal</h1>
    <p>Server is running.</p>
  `);
});

app.use(`${ROUTES.API}${API_ENDPOINTS.TURN_CREDENTIALS}`, turnLimiter);
app.use(`${ROUTES.API}${API_ENDPOINTS.TURN_TOKEN}`, turnTokenLimiter);

app.use(ROUTES.API, (req, res, next) => {
  if (
    req.path === API_ENDPOINTS.TURN_CREDENTIALS ||
    req.path === API_ENDPOINTS.TURN_TOKEN
  ) {
    return next();
  }
  return apiLimiter(req, res, next);
}, apiRoutes);

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

const getBucket = (socketId) => {
  let bucket = socketBuckets.get(socketId);
  if (!bucket) {
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
    const bucket = getBucket(socket.id);
    if (bucket.tokens < 1) {
      console.warn(`Socket ${socket.id} rate-limited on event "${eventName}"`);
      socket.emit("rate-limited", { event: eventName });
      return;
    }
    bucket.tokens -= 1;
    originalOnevent(packet);
  };
  socket.on("disconnect", () => {
    socketBuckets.delete(socket.id);
  });
  next();
});

handleSocketConnection(io, connectionStats);

const PORT = parseInt(process.env.PORT, 10) || config.port;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Server bound to ${HOST}:${PORT}. Connect in browser with http://localhost:${PORT}`);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});
