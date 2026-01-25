// Server entry point
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const helmet = require("helmet");

const apiRoutes = require("./routes/api");
const connectionStats = require("./utils/connectionStats");
const { handleSocketConnection } = require("./socket/handlers");
const { HTTP_STATUS } = require("./config/constants");

const environment = process.env.NODE_ENV || "development";
const config = require(`./config/${environment}`);

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  transports: config.transports,
});

if (environment === "production") {
  app.use(
    require("cors")({
      origin: config.cors,
      optionsSuccessStatus: HTTP_STATUS.OK,
    })
  );
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "blob:"],
      },
    },
  })
);

app.set("connectionStats", connectionStats);

if (environment !== "production") {
  app.use(express.static("public"));
}

app.get("/test", (req, res) => {
  console.log("Ping");
  res.status(200).send(`
    <h1>RTC Portal</h1>
    <p>Server is running.</p>
  `);
});

app.use("/api", apiRoutes);

handleSocketConnection(io, connectionStats);

const PORT = config.port;
server.listen(PORT, () => {
  if (environment !== "production") {
    console.log(`Server running on http://localhost:${PORT}`);
  }
});
