// Handles Socket.IO events
const handleSocketConnection = (io, connectionStats) => {
  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("connection-attempt", () => {
      connectionStats.incrementAttempts();
    });

    socket.on("connection-success", () => {
      connectionStats.incrementSuccesses();
    });

    socket.on("connection-user-failed", () => {
      connectionStats.decrementAttempts();
    });

    socket.on("offer", (payload) => {
      console.log(`Received offer from ${socket.id} to ${payload.target}`);

      if (payload.target === socket.id) {
        return; // Prevent self-signaling
      }

      const targetSocket = io.sockets.sockets.get(payload.target);
      if (!targetSocket) {
        socket.emit("peer-not-found", { target: payload.target });
        return;
      }

      io.to(payload.target).emit("offer", {
        sdp: payload.sdp,
        caller: socket.id,
      });
    });

    socket.on("answer", (payload) => {
      console.log(`Received answer from ${socket.id} to ${payload.target}`);
      io.to(payload.target).emit("answer", {
        sdp: payload.sdp,
        callee: socket.id,
      });
    });

    socket.on("candidate", (payload) => {
      console.log(`Received candidate from ${socket.id} to ${payload.target}`);
      io.to(payload.target).emit("candidate", {
        candidate: payload.candidate,
        from: socket.id,
      });
    });
  });
};

module.exports = { handleSocketConnection };
