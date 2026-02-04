const relayToTarget = (io, socket, payload, event, dataBuilder) => {
  io.to(payload.target).emit(event, dataBuilder(payload, socket.id));
};

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
        return;
      }

      const targetSocket = io.sockets.sockets.get(payload.target);
      if (!targetSocket) {
        socket.emit("peer-not-found", { target: payload.target });
        return;
      }

      relayToTarget(io, socket, payload, "offer", (data, senderId) => ({
        sdp: data.sdp,
        caller: senderId,
      }));
    });

    socket.on("answer", (payload) => {
      console.log(`Received answer from ${socket.id} to ${payload.target}`);
      relayToTarget(io, socket, payload, "answer", (data, senderId) => ({
        sdp: data.sdp,
        callee: senderId,
      }));
    });

    socket.on("candidate", (payload) => {
      console.log(`Received candidate from ${socket.id} to ${payload.target}`);
      relayToTarget(io, socket, payload, "candidate", (data, senderId) => ({
        candidate: data.candidate,
        from: senderId,
      }));
    });
  });
};

module.exports = { handleSocketConnection };
