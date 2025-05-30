const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const helmet = require("helmet");
const fetch = require("node-fetch");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(helmet());

if (process.env.NODE_ENV !== "production") {
  app.use(express.static("public"));
}

app.get("/test", (req, res) => {
  console.log("Ping");
  res.status(200).send(`
    <h1>RTC Portal</h1>
    <p>Server is running.</p>
  `);
});

// return TURN servers from Open Relay
app.get("/api/turn-credentials", async (req, res) => {
  const apiKey = process.env.METERED_API_KEY;

  if (!apiKey) {
    console.error("METERED_API_KEY environment variable is not set.");
    return res
      .status(500)
      .json({ error: "API key not configured on the server." });
  }

  const meteredApiUrl = `https://rtcportal.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;

  try {
    const response = await fetch(meteredApiUrl);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Metered API request failed: ${response.status} ${response.statusText}`,
        errorText
      );
      return res
        .status(response.status)
        .json({
          error: "Failed to fetch TURN credentials from Metered API.",
          details: errorText,
        });
    }
    const iceServers = await response.json();
    res.status(200).json(iceServers);
  } catch (error) {
    console.error("Error fetching or processing TURN credentials:", error);
    res
      .status(500)
      .json({ error: "Server error while fetching TURN credentials." });
  }
});

// when a client connects to Socket.IO server
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // listen for an "offer" event from a client
  socket.on("offer", (payload) => {
    // relay it to payload.target
    io.to(payload.target).emit("offer", {
      sdp: payload.sdp,
      caller: socket.id,
    });
  });

  // listen for an "answer" event from a client
  socket.on("answer", (payload) => {
    // relay it to payload.target
    io.to(payload.target).emit("answer", {
      sdp: payload.sdp,
      callee: socket.id,
    });
  });

  // listen for ICE "candidate" events
  socket.on("candidate", (payload) => {
    // relay it to payload.target to add to their RTCPeerConnection
    io.to(payload.target).emit("candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  if (process.env.NODE_ENV !== "production") {
    console.log(`Server running on http://localhost:${PORT}`);
  }
});
