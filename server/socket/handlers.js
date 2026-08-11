const pinMap = new Map();
const activePairings = new Map();
const pairingTimestamps = new Map();

const PAIRING_TTL_MS = 600000;
const PAIRING_SWEEP_INTERVAL_MS = 60000;
const PENDING_DISCONNECT_TTL_MS = 120000;

let pairingSweepStarted = false;
const pendingDisconnects = new Map();

const pairKey = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  return a < b ? `${a}:${b}` : `${b}:${a}`;
};

const ADJECTIVES = [
  "blue",
  "fast",
  "silent",
  "red",
  "green",
  "clever",
  "brave",
  "shiny",
  "happy",
  "wild",
  "crypto",
  "quantum",
  "digital",
  "bold",
  "dark",
];
const NOUNS = [
  "horse",
  "staple",
  "tiger",
  "mountain",
  "river",
  "ocean",
  "forest",
  "eagle",
  "falcon",
  "lion",
  "node",
  "hash",
  "cloud",
  "packet",
  "stream",
];
const crypto = require("crypto");
const proxyaddr = require("proxy-addr");

// Resolve the real client IP from a Socket.IO socket using the same library
// Express uses internally for `req.ip`. Trusting the single immediate proxy
// (the socket's own direct address) mirrors `app.set("trust proxy", 1)`, so
// the IP recorded here matches the IP checked against the per-IP quota on the
// HTTP API — even when running behind a reverse proxy.
const getClientIpFromSocket = (socket) => {
  if (!socket) return "unknown";
  const req = socket.request;
  if (!req) return socket.handshake?.address || "unknown";
  const directAddress =
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    socket.handshake?.address ||
    "unknown";
  const trustImmediateProxy = (ip) => ip === directAddress;
  try {
    return proxyaddr(req, trustImmediateProxy);
  } catch {
    return directAddress;
  }
};

const generatePin = () => {
  const adj = ADJECTIVES[crypto.randomInt(0, ADJECTIVES.length)];
  const adj2 = ADJECTIVES[crypto.randomInt(0, ADJECTIVES.length)];
  const noun = NOUNS[crypto.randomInt(0, NOUNS.length)];
  const num = crypto.randomInt(100, 999);
  return `${adj}-${adj2}-${noun}-${num}`;
};

const resolveTargetSocketId = (target) => {
  if (!target) return null;
  return pinMap.has(target) ? pinMap.get(target) : target;
};

const hasRequiredPayloadFields = (
  payload,
  requiredFields,
  { allowNullFields = [] } = {},
) => {
  if (!payload) return false;
  return requiredFields.every((field) =>
    allowNullFields.includes(field) ? field in payload : payload[field] != null,
  );
};

const isValidSignalTarget = (target) =>
  typeof target === "string" && target.trim() !== "";

const isValidObject = (value, { allowNull = false } = {}) =>
  (allowNull && value === null) ||
  (value !== null && typeof value === "object" && !Array.isArray(value));

const emitPeerNotFound = (socket, target) => {
  socket.emit("peer-not-found", { target });
};

const getSocketIdentity = (socket) => socket.pin || socket.id;

// Evicts a peer from its pairing and notifies it that it has been replaced.
// Used when an offer makes an existing pairing obsolete (either the target
// is being taken over, or the sender is abandoning its current peer).
// `pairedWithId` is the other half of the pairing being torn down, and
// `replacementSocket` is the socket that is taking over (used for the
// notification identity).
const evictPeerAndNotify = (
  io,
  evictedPeerId,
  pairedWithId,
  replacementSocket,
) => {
  const evictedSocket = io.sockets.sockets.get(evictedPeerId);
  if (evictedSocket) {
    evictedSocket.emit("peer-replaced", {
      from: getSocketIdentity(replacementSocket),
    });
  }
  activePairings.delete(evictedPeerId);
  activePairings.delete(pairedWithId);
  pairingTimestamps.delete(evictedPeerId);
  pairingTimestamps.delete(pairedWithId);
};

const handleSocketConnection = (io, connectionStats) => {
  if (!pairingSweepStarted) {
    pairingSweepStarted = true;
    setInterval(() => {
      if (activePairings.size === 0) return;
      const now = Date.now();
      const toDelete = [];
      const seen = new Set();
      for (const [socketId] of activePairings) {
        // Skip duplicate entries (activePairings is bidirectional)
        if (seen.has(socketId)) continue;
        const targetId = activePairings.get(socketId);
        if (!targetId) {
          toDelete.push(socketId);
          continue;
        }
        seen.add(socketId);
        seen.add(targetId);

        const connectedAt = pairingTimestamps.get(socketId) || 0;
        if (now - connectedAt > PAIRING_TTL_MS) {
          const s = io.sockets.sockets.get(socketId);
          const t = io.sockets.sockets.get(targetId);

          // If both sockets are still connected, notify them immediately
          // rather than creating a pendingDisconnect that may never resolve.
          if (s && t) {
            s.emit("peer-disconnected", {
              from: t.pin || t.id,
              reason: "ttl-expired",
            });
            t.emit("peer-disconnected", {
              from: s.pin || s.id,
              reason: "ttl-expired",
            });
          } else {
            // One or both sockets are gone — defer notification in case
            // they reconnect and complete a transfer.
            const key = pairKey(socketId, targetId);
            const completed = new Set();
            if (!s) completed.add(socketId);
            if (!t) completed.add(targetId);
            pendingDisconnects.set(key, {
              sockets: [socketId, targetId],
              completed,
              createdAt: now,
            });
          }

          toDelete.push(socketId, targetId);
        }
      }
      for (const id of toDelete) {
        activePairings.delete(id);
        pairingTimestamps.delete(id);
      }

      // Clean up stale pendingDisconnects entries to prevent memory leaks.
      const pendingCutoff = now - PENDING_DISCONNECT_TTL_MS;
      for (const [key, info] of pendingDisconnects) {
        // Remove entries older than the TTL, or entries where all sockets
        // are disconnected (orphaned).
        const allDisconnected = info.sockets.every(
          (sId) => !io.sockets.sockets.get(sId),
        );
        const isStale = info.createdAt && info.createdAt < pendingCutoff;
        if (allDisconnected || isStale) {
          pendingDisconnects.delete(key);
        }
      }
    }, PAIRING_SWEEP_INTERVAL_MS);
  }

  io.on("connection", (socket) => {
    const selfTargetResolveOptions = {
      preventSelfTarget: true,
    };

    let pin;
    let pinRetries = 0;
    const MAX_PIN_RETRIES = 100;
    do {
      pin = generatePin();
      pinRetries++;
    } while (pinMap.has(pin) && pinRetries < MAX_PIN_RETRIES);

    if (pinMap.has(pin)) {
      console.error("Failed to generate unique PIN after maximum retries");
      socket.emit("error", {
        message: "Server is at capacity. Please try again later.",
      });
      socket.disconnect(true);
      return;
    }

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
      allowNullFields = [],
    }) => {
      if (
        !hasRequiredPayloadFields(payload, requiredFields, { allowNullFields })
      ) {
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
      allowNullFields = [],
    }) => {
      socket.on(incomingEvent, (payload) => {
        const targetId = resolveValidatedRelayTarget({
          payload,
          requiredFields,
          validatePayload,
          resolveOptions,
          allowNullFields,
        });
        if (!targetId) {
          return;
        }

        if (typeof beforeRelay === "function") {
          const shouldRelay = beforeRelay(targetId, payload);
          if (shouldRelay === false) {
            return;
          }
        }

        relayEventToTarget(targetId, outgoingEvent, () =>
          payloadBuilder({ payload, targetId }),
        );
      });
    };

    const cleanupSocketState = () => {
      const targetId = activePairings.get(socket.id);
      if (targetId) {
        activePairings.delete(socket.id);
        activePairings.delete(targetId);
        pairingTimestamps.delete(socket.id);
        pairingTimestamps.delete(targetId);
      }

      if (socket.pin && pinMap.get(socket.pin) === socket.id) {
        pinMap.delete(socket.pin);
      }
      pairingTimestamps.delete(socket.id);
      socket._hasPendingAttempt = false;
    };

    const statsRateTracker = new Map();
    const STATS_RATE_LIMIT = { maxEvents: 10, windowMs: 60000 };
    const STATS_TRACKER_MAX_SIZE = 100;

    const isStatsRateLimited = (eventName) => {
      const now = Date.now();
      const key = `${socket.id}:${eventName}`;
      const lastTime = statsRateTracker.get(key) || 0;
      const minInterval =
        STATS_RATE_LIMIT.windowMs / STATS_RATE_LIMIT.maxEvents;

      if (now - lastTime < minInterval) {
        return true;
      }
      statsRateTracker.set(key, now);

      // Cap total entries to prevent memory growth from many event types
      if (statsRateTracker.size > STATS_TRACKER_MAX_SIZE) {
        const cutoff = now - STATS_RATE_LIMIT.windowMs;
        for (const [k, v] of statsRateTracker) {
          if (v < cutoff) statsRateTracker.delete(k);
        }
        // If still over cap after pruning expired, remove oldest entries
        if (statsRateTracker.size > STATS_TRACKER_MAX_SIZE) {
          const sorted = [...statsRateTracker.entries()].sort(
            (a, b) => a[1] - b[1],
          );
          const toRemove = sorted.slice(
            0,
            statsRateTracker.size - STATS_TRACKER_MAX_SIZE,
          );
          for (const [k] of toRemove) {
            statsRateTracker.delete(k);
          }
        }
      }
      return false;
    };

    socket.on("disconnect", () => {
      const targetId = activePairings.get(socket.id);
      if (targetId) {
        io.to(targetId).emit("peer-disconnected", {
          from: getSocketIdentity(socket),
        });
      }
      cleanupSocketState();

      // Clean up any pendingDisconnects entries involving this socket.
      // If the socket was part of a deferred TTL disconnect, the other
      // side needs to be notified since this socket can no longer send
      // transfer-complete to resolve the pending entry.
      for (const [key, info] of pendingDisconnects) {
        if (!Array.isArray(info.sockets)) continue;
        if (!info.sockets.includes(socket.id)) continue;

        info.completed.add(socket.id);
        const allCompleted = info.sockets.every((sId) =>
          info.completed.has(sId),
        );
        if (allCompleted) {
          for (const sId of info.sockets) {
            const sSock = io.sockets.sockets.get(sId);
            if (sSock) {
              const otherId = info.sockets.find((x) => x !== sId) || null;
              const otherSock = otherId
                ? io.sockets.sockets.get(otherId)
                : null;
              sSock.emit("peer-disconnected", {
                from: otherSock ? getSocketIdentity(otherSock) : null,
                reason: "peer-disconnected-during-transfer",
              });
            }
          }
          pendingDisconnects.delete(key);
        } else {
          pendingDisconnects.set(key, info);
        }
      }

      for (const key of [...statsRateTracker.keys()]) {
        if (key.startsWith(socket.id + ":")) {
          statsRateTracker.delete(key);
        }
      }
    });

    socket.on("error", () => {
      cleanupSocketState();

      for (const key of [...statsRateTracker.keys()]) {
        if (key.startsWith(socket.id + ":")) {
          statsRateTracker.delete(key);
        }
      }
    });

    socket.on("connection-attempt", () => {
      if (isStatsRateLimited("connection-attempt")) return;
      // Only count if not already pending — prevents stat manipulation
      // by spamming connection-attempt events.
      if (!socket._hasPendingAttempt) {
        socket._hasPendingAttempt = true;
        connectionStats.incrementAttempts();
      }
    });

    socket.on("connection-success", () => {
      if (isStatsRateLimited("connection-success")) return;
      socket._hasPendingAttempt = false;
      connectionStats.incrementSuccesses();
      const targetId = activePairings.get(socket.id);
      if (targetId) {
        const now = Date.now();
        pairingTimestamps.set(socket.id, now);
        pairingTimestamps.set(targetId, now);
      }
    });

    socket.on("connection-user-failed", () => {
      if (isStatsRateLimited("connection-user-failed")) return;
      // Only decrement if this socket had a pending attempt — prevents
      // stat manipulation by spamming connection-user-failed.
      if (socket._hasPendingAttempt) {
        socket._hasPendingAttempt = false;
        connectionStats.decrementAttempts();
      }
    });

    socket.on("transfer-complete", (payload) => {
      if (isStatsRateLimited("transfer-complete")) return;
      if (
        payload &&
        payload.confirmed === true &&
        typeof payload.fileSize === "number" &&
        Number.isFinite(payload.fileSize) &&
        payload.fileSize >= 0
      ) {
        const fileCount =
          typeof payload.fileCount === "number" &&
          Number.isFinite(payload.fileCount) &&
          payload.fileCount > 0
            ? payload.fileCount
            : 1;
        connectionStats.addTransfer(payload.fileSize, fileCount);

        // Track per-IP bandwidth for quota enforcement.
        // Only count from the sender (initiator) to avoid double-counting
        // in case both peers emit transfer-complete.
        if (payload.isSender) {
          // Use the same client-IP extraction as the HTTP API so the
          // recorded IP matches what isChecked against the quota. Behind a
          // proxy this resolves the real client IP from X-Forwarded-For.
          const clientIp = getClientIpFromSocket(socket);
          connectionStats.addIpBandwidth(clientIp, payload.fileSize);
        }
      }

      // If this socket was part of any pending TTL-triggered disconnects,
      // mark it completed and, if all sides have completed, notify peers.
      for (const [key, info] of pendingDisconnects) {
        if (!Array.isArray(info.sockets)) continue;
        if (!info.sockets.includes(socket.id)) continue;

        info.completed.add(socket.id);

        // If all expected sockets are completed, emit peer-disconnected to connected sockets
        const allCompleted = info.sockets.every((sId) =>
          info.completed.has(sId),
        );
        if (allCompleted) {
          for (const sId of info.sockets) {
            const sSock = io.sockets.sockets.get(sId);
            if (sSock) {
              const otherId = info.sockets.find((x) => x !== sId) || null;
              const otherSock = otherId
                ? io.sockets.sockets.get(otherId)
                : null;
              sSock.emit("peer-disconnected", {
                from: otherSock ? getSocketIdentity(otherSock) : null,
                reason: "ttl-expired-after-transfer",
              });
            }
          }
          pendingDisconnects.delete(key);
        } else {
          // update stored info
          pendingDisconnects.set(key, info);
        }
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
      beforeRelay: (targetId, _payload) => {
        // Notify + drop peers that become obsolete when an offer arrives.
        //
        // Case 1: the TARGET (targetId) is already paired with a different
        // peer. That existing peer is being replaced by the caller, so it
        // must be evicted so the new peer can connect seamlessly.
        const existingTargetPair = activePairings.get(targetId);
        if (existingTargetPair && existingTargetPair !== socket.id) {
          evictPeerAndNotify(io, existingTargetPair, targetId, socket);
        }

        // Case 2: the SENDER (socket) is currently paired with someone else
        // and is now initiating a fresh connection elsewhere. That old peer
        // is being abandoned, so evict it and let it clean up gracefully.
        const existingSenderPair = activePairings.get(socket.id);
        if (existingSenderPair && existingSenderPair !== targetId) {
          evictPeerAndNotify(io, existingSenderPair, socket.id, socket);
        }
      },
      payloadBuilder: ({ payload }) => ({
        sdp: payload.sdp,
        caller: getSocketIdentity(socket),
      }),
    });

    registerRelayEvent({
      incomingEvent: "answer",
      outgoingEvent: "answer",
      requiredFields: ["target", "sdp"],
      resolveOptions: {
        ...selfTargetResolveOptions,
        requireLiveSocket: true,
      },
      validatePayload: (data) => isValidObject(data.sdp),
      beforeRelay: (targetId) => {
        socket._hasPendingAttempt = false;
        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) targetSocket._hasPendingAttempt = false;
        activePairings.set(socket.id, targetId);
        activePairings.set(targetId, socket.id);
        const now = Date.now();
        pairingTimestamps.set(socket.id, now);
        pairingTimestamps.set(targetId, now);
      },
      payloadBuilder: ({ payload, targetId }) => ({
        sdp: payload.sdp,
        callee: getSocketIdentity(socket),
        targetSocketId: targetId,
      }),
    });

    registerRelayEvent({
      incomingEvent: "candidate",
      outgoingEvent: "candidate",
      requiredFields: ["target", "candidate"],
      validatePayload: (data) =>
        isValidObject(data.candidate, { allowNull: true }),
      resolveOptions: selfTargetResolveOptions,
      allowNullFields: ["candidate"],
      payloadBuilder: ({ payload }) => ({
        candidate: payload.candidate,
        from: getSocketIdentity(socket),
      }),
    });

    registerRelayEvent({
      incomingEvent: "peer-disconnected",
      outgoingEvent: "peer-disconnected",
      requiredFields: ["target"],
      resolveOptions: {
        ...selfTargetResolveOptions,
        requireLiveSocket: true,
      },
      beforeRelay: (targetId) => {
        if (activePairings.get(socket.id) === targetId) {
          activePairings.delete(socket.id);
          activePairings.delete(targetId);
        }
      },
      payloadBuilder: () => ({
        from: getSocketIdentity(socket),
      }),
    });
  });
};

module.exports = { handleSocketConnection };
