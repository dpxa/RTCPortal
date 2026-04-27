const pinMap = new Map();
const activePairings = new Map();

const generatePin = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const resolveTargetSocketId = (target) => {
  if (!target) return null;
  return pinMap.has(target) ? pinMap.get(target) : target;
};

const hasRequiredPayloadFields = (payload, requiredFields) => {
  if (!payload) return false;
  return requiredFields.every((field) => payload[field] != null);
};

const isValidSignalTarget = (target) =>
  typeof target === "string" && target.trim() !== "";

const isValidObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const emitPeerNotFound = (socket, target) => {
  socket.emit("peer-not-found", { target });
};

const handleSocketConnection = (io, connectionStats) => {
  io.on("connection", (socket) => {
    let pin;
    do {
      pin = generatePin();
    } while (pinMap.has(pin));

    pinMap.set(pin, socket.id);
    socket.pin = pin;

    console.log(`Socket connected: PIN ${pin}`);

    socket.emit("pin-assigned", { pin });

    const resolveRelayTarget = (payload, options = {}) => {
      const {
        decrementAttemptsOnMissing = false,
        emitPeerNotFoundOnMissing = false,
        preventSelfTarget = false,
        requireLiveSocket = false,
      } = options;

      const targetId = resolveTargetSocketId(payload?.target);

      if (!targetId) {
        if (decrementAttemptsOnMissing) {
          connectionStats.decrementAttempts();
        }
        if (emitPeerNotFoundOnMissing) {
          emitPeerNotFound(socket, payload?.target);
        }
        return null;
      }

      if (preventSelfTarget && targetId === socket.id) {
        return null;
      }

      if (requireLiveSocket && !io.sockets.sockets.get(targetId)) {
        if (decrementAttemptsOnMissing) {
          connectionStats.decrementAttempts();
        }
        if (emitPeerNotFoundOnMissing) {
          emitPeerNotFound(socket, payload?.target);
        }
        return null;
      }

      return targetId;
    };

    const resolveValidatedRelayTarget = ({
      payload,
      requiredFields,
      validatePayload,
      resolveOptions,
    }) => {
      if (!hasRequiredPayloadFields(payload, requiredFields)) {
        return null;
      }

      if (!isValidSignalTarget(payload.target)) {
        return null;
      }

      if (typeof validatePayload === "function" && !validatePayload(payload)) {
        return null;
      }

      return resolveRelayTarget(payload, resolveOptions);
    };

    socket.on("disconnect", () => {
      const targetId = activePairings.get(socket.id);
      if (targetId) {
        io.to(targetId).emit("peer-disconnected", {
          from: socket.pin || socket.id,
        });
        activePairings.delete(socket.id);
        activePairings.delete(targetId);
      }

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

    socket.on("transfer-complete", (payload) => {
      if (
        payload &&
        payload.confirmed === true &&
        typeof payload.fileSize === "number"
      ) {
        const fileCount =
          typeof payload.fileCount === "number" ? payload.fileCount : 1;
        connectionStats.addTransfer(payload.fileSize, fileCount);
      }
    });

    socket.on("offer", (payload) => {
      const targetId = resolveValidatedRelayTarget({
        payload,
        requiredFields: ["target", "sdp"],
        validatePayload: (data) => isValidObject(data.sdp),
        resolveOptions: {
          decrementAttemptsOnMissing: true,
          emitPeerNotFoundOnMissing: true,
          preventSelfTarget: true,
          requireLiveSocket: true,
        },
      });
      if (!targetId) {
        return;
      }

      io.to(targetId).emit("offer", {
        sdp: payload.sdp,
        caller: socket.pin || socket.id,
      });
    });

    socket.on("answer", (payload) => {
      const targetId = resolveValidatedRelayTarget({
        payload,
        requiredFields: ["target", "sdp"],
        validatePayload: (data) => isValidObject(data.sdp),
        resolveOptions: {
          preventSelfTarget: true,
        },
      });
      if (!targetId) {
        return;
      }

      activePairings.set(socket.id, targetId);
      activePairings.set(targetId, socket.id);

      io.to(targetId).emit("answer", {
        sdp: payload.sdp,
        callee: socket.pin || socket.id,
      });
    });

    socket.on("candidate", (payload) => {
      const targetId = resolveValidatedRelayTarget({
        payload,
        requiredFields: ["target", "candidate"],
        validatePayload: (data) => isValidObject(data.candidate),
        resolveOptions: {
          preventSelfTarget: true,
        },
      });
      if (!targetId) {
        return;
      }

      io.to(targetId).emit("candidate", {
        candidate: payload.candidate,
        from: socket.pin || socket.id,
      });
    });

    socket.on("peer-disconnected", (payload) => {
      const targetId = resolveValidatedRelayTarget({
        payload,
        requiredFields: ["target"],
        resolveOptions: {
          preventSelfTarget: true,
        },
      });
      if (!targetId) {
        return;
      }

      activePairings.delete(socket.id);
      activePairings.delete(targetId);

      io.to(targetId).emit("peer-disconnected", {
        from: socket.pin || socket.id,
      });
    });
  });
};

module.exports = { handleSocketConnection };
