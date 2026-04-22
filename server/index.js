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
  max: RATE_LIMIT.MAX_API_REQUESTS,
  message: { error: RATE_LIMIT.MESSAGES.API_LIMIT },
  standardHeaders: true,
  legacyHeaders: false,
});

const turnLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.MAX_TURN_REQUESTS,
  message: {
    error: RATE_LIMIT.MESSAGES.TURN_LIMIT,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

if (!isProd) {
  app.use(express.static("public"));
}

app.get(ROUTES.TEST, (req, res) => {
  console.log("Ping");
  res.status(200).send(`
    <h1>RTC Portal</h1>
    <p>Server is running.</p>
  `);
});

app.use(`${ROUTES.API}${API_ENDPOINTS.TURN_CREDENTIALS}`, turnLimiter);
app.use(ROUTES.API, apiLimiter, apiRoutes);

app.use(ROUTES.API, (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

app.use(ROUTES.API, (err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

handleSocketConnection(io, connectionStats);

const PORT = parseInt(process.env.PORT, 10) || config.port;
const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  if (!isProd) {
    console.log(
      `Server bound to ${HOST}:${PORT}. Connect in browser with http://localhost:${PORT}`,
    );
  }
});
