const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const helmet = require("helmet");

// Import custom modules
const apiRoutes = require("./routes/api");
const connectionStats = require("./utils/connectionStats");
const { handleSocketConnection } = require("./socket/handlers");
const { createCorsOptions } = require("./middleware/cors");

// Load configuration
const environment = process.env.NODE_ENV || "development";
const config = require(`./config/${environment}`);

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  transports: config.socketIO.transports,
});

// Configure middleware
app.use(require("cors")(createCorsOptions(environment)));
app.use(helmet());

// Make connection stats available to routes
app.set("connectionStats", connectionStats);

// Serve static files in development
if (environment !== "production") {
  app.use(express.static("public"));
}

// Basic health check endpoint
app.get("/test", (req, res) => {
  console.log("Ping");
  res.status(200).send(`
    <h1>RTC Portal</h1>
    <p>Server is running.</p>
  `);
});

// API routes
app.use("/api", apiRoutes);

// Initialize Socket.IO handlers
handleSocketConnection(io, connectionStats);

// Start server
const PORT = config.server.port;
server.listen(PORT, () => {
  if (environment !== "production") {
    console.log(`Server running on http://localhost:${PORT}`);
  }
});
