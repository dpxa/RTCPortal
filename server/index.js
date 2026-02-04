const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const apiRoutes = require("./routes/api");
const connectionStats = require("./utils/connectionStats");
const { handleSocketConnection } = require("./socket/handlers");
const { HTTP_STATUS } = require("./config/constants");

const environment = process.env.NODE_ENV || "development";
const isProd = environment === "production";
const config = require(`./config/${environment}`);

const app = express();
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
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const turnLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many TURN credential requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

if (!isProd) {
  app.use(express.static("public"));
}

app.get("/test", (req, res) => {
  console.log("Ping");
  res.status(200).send(`
    <h1>RTC Portal</h1>
    <p>Server is running.</p>
  `);
});

app.use("/api", apiLimiter, apiRoutes);
app.use("/api/turn-credentials", turnLimiter);

handleSocketConnection(io, connectionStats);

const PORT = config.port;
server.listen(PORT, () => {
  if (!isProd) {
    console.log(`Server running on http://localhost:${PORT}`);
  }
});

// test comment
