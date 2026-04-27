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

const getSocketIdentity = (socket) => socket.pin || socket.id;

const handleSocketConnection = (io, connectionStats) => {
  io.on("connection", (socket) => {
    const selfTargetResolveOptions = {
      preventSelfTarget: true,
    };
    const signalRelayRequiredFields = ["target", "sdp"];

    let pin;
    do {
      pin = generatePin();
    } while (pinMap.has(pin));

    pinMap.set(pin, socket.id);
    socket.pin = pin;

    console.log(`Socket connected: PIN ${pin}`);

    socket.emit("pin-assigned", { pin });

    const handleMissingRelayTarget = (payloadTarget, options = {}) => {
      const {
        decrementAttemptsOnMissing = false,
        emitPeerNotFoundOnMissing = false,
      } = options;

      if (decrementAttemptsOnMissing) {
        connectionStats.decrementAttempts();
      }

      if (emitPeerNotFoundOnMissing) {
        emitPeerNotFound(socket, payloadTarget);
      }

      return null;
    };

    const resolveRelayTarget = (payload, options = {}) => {
      const {
        decrementAttemptsOnMissing = false,
        emitPeerNotFoundOnMissing = false,
        preventSelfTarget = false,
        requireLiveSocket = false,
      } = options;

      const targetId = resolveTargetSocketId(payload?.target);

      if (!targetId) {
        return handleMissingRelayTarget(payload?.target, {
          decrementAttemptsOnMissing,
          emitPeerNotFoundOnMissing,
        });
      }

      if (preventSelfTarget && targetId === socket.id) {
        return null;
      }

      if (requireLiveSocket && !io.sockets.sockets.get(targetId)) {
        return handleMissingRelayTarget(payload?.target, {
          decrementAttemptsOnMissing,
          emitPeerNotFoundOnMissing,
        });
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

    const relayEventToTarget = (targetId, eventName, payloadBuilder) => {
      io.to(targetId).emit(eventName, payloadBuilder());
    };

    const registerRelayEvent = ({
      incomingEvent,
      outgoingEvent,
      requiredFields,
      validatePayload,
      resolveOptions,
      beforeRelay,
      payloadBuilder,
    }) => {
      socket.on(incomingEvent, (payload) => {
        const targetId = resolveValidatedRelayTarget({
          payload,
          requiredFields,
          validatePayload,
          resolveOptions,
        });
        if (!targetId) {
          return;
        }

        if (typeof beforeRelay === "function") {
          beforeRelay(targetId, payload);
        }

        relayEventToTarget(targetId, outgoingEvent, () =>
          payloadBuilder({ payload, targetId }),
        );
      });
    };

    socket.on("disconnect", () => {
      const targetId = activePairings.get(socket.id);
      if (targetId) {
        io.to(targetId).emit("peer-disconnected", {
          from: getSocketIdentity(socket),
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

    registerRelayEvent({
      incomingEvent: "offer",
      outgoingEvent: "offer",
      requiredFields: ["target", "sdp"],
      validatePayload: (data) => isValidObject(data.sdp),
      resolveOptions: {
        decrementAttemptsOnMissing: true,
        emitPeerNotFoundOnMissing: true,
        preventSelfTarget: true,
        requireLiveSocket: true,
      },
      payloadBuilder: ({ payload }) => ({
        sdp: payload.sdp,
        caller: getSocketIdentity(socket),
      }),
    });

    registerRelayEvent({
      incomingEvent: "answer",
      outgoingEvent: "answer",
      requiredFields: signalRelayRequiredFields,
      validatePayload: (data) => isValidObject(data.sdp),
      resolveOptions: selfTargetResolveOptions,
      beforeRelay: (targetId) => {
        activePairings.set(socket.id, targetId);
        activePairings.set(targetId, socket.id);
      },
      payloadBuilder: ({ payload }) => ({
        sdp: payload.sdp,
        callee: getSocketIdentity(socket),
      }),
    });

    registerRelayEvent({
      incomingEvent: "candidate",
      outgoingEvent: "candidate",
      requiredFields: ["target", "candidate"],
      validatePayload: (data) => isValidObject(data.candidate),
      resolveOptions: selfTargetResolveOptions,
      payloadBuilder: ({ payload }) => ({
        candidate: payload.candidate,
        from: getSocketIdentity(socket),
      }),
    });

    registerRelayEvent({
      incomingEvent: "peer-disconnected",
      outgoingEvent: "peer-disconnected",
      requiredFields: ["target"],
      resolveOptions: selfTargetResolveOptions,
      beforeRelay: (targetId) => {
        activePairings.delete(socket.id);
        activePairings.delete(targetId);
      },
      payloadBuilder: () => ({
        from: getSocketIdentity(socket),
      }),
    });
  });
};

module.exports = { handleSocketConnection };
