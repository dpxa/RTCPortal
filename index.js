const express = require("express");
const http = require("http");
const path = require("path");
const socketIO = require("socket.io");
const helmet = require("helmet");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(helmet());

if (process.env.NODE_ENV !== "production") {
  app.use(express.static("public"));
}

app.get("/test", (req, res) => {
  console.log(`[${getTimestampPST()}] Ping`);
  res.status(200).send(`
    <h1>RTC Portal</h1>
    <p>Server is running.</p>
  `);
});

const getTimestampPST = () => {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
  });
};

// when a client connects to Socket.IO server
io.on("connection", (socket) => {
  console.log(`[${getTimestampPST()}] Socket connected: ${socket.id}`);

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
