const pinMap = new Map();

const generatePin = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const relayToTarget = (io, socket, payload, event, dataBuilder) => {
  let targetId = payload.target;
  if (pinMap.has(targetId)) {
    targetId = pinMap.get(targetId);
  }
  io.to(targetId).emit(event, dataBuilder(payload, socket.pin || socket.id));
};

const handleSocketConnection = (io, connectionStats) => {
  io.on("connection", (socket) => {
    let pin;
    do {
      pin = generatePin();
    } while (pinMap.has(pin));

    pinMap.set(pin, socket.id);
    socket.pin = pin;

    console.log(`Socket connected: ${socket.id} (PIN: ${pin})`);

    socket.emit("pin-assigned", { pin });

    socket.on("disconnect", () => {
      if (socket.pin) {
        pinMap.delete(socket.pin);
      }
    });

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

      let targetId = payload.target;
      if (pinMap.has(targetId)) {
        targetId = pinMap.get(targetId);
      }

      if (targetId === socket.id) {
        return;
      }

      const targetSocket = io.sockets.sockets.get(targetId);
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
