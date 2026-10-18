const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const path = require("path");
const { io } = require("socket.io-client");

const SERVER_ENTRY = path.resolve(__dirname, "../../server/index.js");
const TEST_PORT = 3199;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProc = null;
let clients = [];

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    const buffer = [];
    const onData = (chunk) => {
      buffer.push(chunk.toString());
      if (!settled && /Server bound to/.test(buffer.join(""))) {
        settled = true;
        resolve();
      }
    };
    serverProc.stdout.on("data", onData);
    serverProc.stderr.on("data", onData);
    serverProc.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    serverProc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Server exited before ready (code ${code})`));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Server did not start within timeout"));
      }
    }, 15000);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverProc) return resolve();
    serverProc.kill();
    serverProc.on("exit", () => resolve());
    setTimeout(resolve, 2000);
  });
}

function connectClient(label) {
  return new Promise((resolve, reject) => {
    const client = io(SERVER_URL, {
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error(`${label}: timed out waiting for pin-assigned`));
    }, 10000);

    client.on("pin-assigned", (data) => {
      clearTimeout(timeout);
      client.pin = data.pin;
      clients.push(client);
      resolve(client);
    });
    client.on("connect_error", (err) => {
      clearTimeout(timeout);
      client.close();
      reject(new Error(`${label}: connect_error ${err.message}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(client, event, { windowMs = 2500 } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.removeListener(event, onEvent);
      resolve(null);
    }, windowMs);
    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    client.once(event, onEvent);
  });
}

function waitForStats(client, predicate = () => true, { windowMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const onStats = (stats) => {
      if (!predicate(stats)) return;
      clearTimeout(timer);
      client.off("connection-stats", onStats);
      resolve(stats);
    };
    const timer = setTimeout(() => {
      client.off("connection-stats", onStats);
      resolve(null);
    }, windowMs);
    client.on("connection-stats", onStats);
  });
}

async function readStats() {
  const res = await fetch(`${SERVER_URL}/api/connection-stats`);
  return res.json();
}

function sendOffer(from, to, { expectReplaced, windowMs = 2500 } = {}) {
  return new Promise((resolve) => {
    let onPeerReplaced = null;
    if (expectReplaced) {
      onPeerReplaced = (payload) => {
        clearTimeout(timer);
        from.removeListener("peer-replaced", onPeerReplaced);
        resolve(payload);
      };
      expectReplaced.on("peer-replaced", onPeerReplaced);
    }
    from.emit("offer", {
      target: to.pin,
      sdp: { type: "offer", sdp: "test-sdp" },
    });
    const timer = setTimeout(() => {
      if (onPeerReplaced && expectReplaced) {
        expectReplaced.removeListener("peer-replaced", onPeerReplaced);
      }
      resolve(null);
    }, windowMs);
  });
}

before(async () => {
  await startServer();
});

after(() => {
  for (const c of clients) c.close();
  clients = [];
  return stopServer();
});

test("pairing A<->B establishes without evicting anyone", async () => {
  const a = await connectClient("A");
  const b = await connectClient("B");
  await sendOffer(a, b);
  b.emit("answer", { target: a.pin, sdp: { type: "answer", sdp: "ans" } });
  await delay(300);

  assert.ok(a.pin && b.pin);
});

test("new peer C offering to B evicts old peer A (target replaced)", async () => {
  const a = await connectClient("A");
  const b = await connectClient("B");
  const c = await connectClient("C");
  await sendOffer(a, b);
  b.emit("answer", { target: a.pin, sdp: { type: "answer", sdp: "ans" } });
  await delay(300);

  const evicted = await sendOffer(c, b, { expectReplaced: a });
  assert.notEqual(evicted, null, "A should be notified when C offers to B");
});

test("peer initiating a new connection away evicts old peer (sender replaced)", async () => {
  const a = await connectClient("A");
  const b = await connectClient("B");
  const c = await connectClient("C");
  await sendOffer(a, b);
  b.emit("answer", { target: a.pin, sdp: { type: "answer", sdp: "ans" } });
  await delay(300);

  const evicted = await sendOffer(b, c, { expectReplaced: a });
  assert.notEqual(
    evicted,
    null,
    "A should be notified when B initiates a connection to C",
  );
});

test("same-pair offer (ICE restart) does not evict anyone", async () => {
  const b = await connectClient("B");
  const c = await connectClient("C");
  await sendOffer(b, c);
  c.emit("answer", { target: b.pin, sdp: { type: "answer", sdp: "ans" } });
  await delay(300);

  const bEvicted = await sendOffer(c, b, { expectReplaced: b });
  const cEvicted = await sendOffer(c, b, { expectReplaced: c });
  assert.equal(bEvicted, null, "B should not be evicted on ICE restart");
  assert.equal(cEvicted, null, "C should not be evicted on ICE restart");
});

test("malformed offer (missing sdp) is not relayed", async () => {
  const c = await connectClient("C");
  const d = await connectClient("D");
  await sendOffer(c, d);
  d.emit("answer", { target: c.pin, sdp: { type: "answer", sdp: "ans" } });
  await delay(300);

  const relayed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1200);
    d.once("offer", () => {
      clearTimeout(timer);
      resolve(true);
    });
    c.emit("offer", { target: d.pin });
  });
  assert.equal(relayed, false, "malformed offer should not be relayed");
});

test("offer to unknown target emits peer-not-found", async () => {
  const d = await connectClient("D");
  d.emit("offer", {
    target: "no-such-pin-12345",
    sdp: { type: "offer", sdp: "x" },
  });
  const notFound = await waitForEvent(d, "peer-not-found", { windowMs: 1500 });
  assert.notEqual(notFound, null, "should receive peer-not-found");
  assert.equal(notFound.target, "no-such-pin-12345");
});

test("offer to self is not relayed", async () => {
  const d = await connectClient("D");
  const selfRelayed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1200);
    d.once("offer", () => {
      clearTimeout(timer);
      resolve(true);
    });
    d.emit("offer", { target: d.pin, sdp: { type: "offer", sdp: "self" } });
  });
  assert.equal(selfRelayed, false, "offer to self should not be relayed");
});

test("disconnecting a paired peer notifies the partner", async () => {
  const c = await connectClient("C");
  const d = await connectClient("D");
  await sendOffer(c, d);
  d.emit("answer", { target: c.pin, sdp: { type: "answer", sdp: "ans" } });
  await delay(300);

  const notice = waitForEvent(c, "peer-disconnected", { windowMs: 1500 });
  d.close();
  const fromD = await notice;
  assert.notEqual(fromD, null, "partner should receive peer-disconnected");
});

test("a newly connected socket is pushed the server-tracked stats", async () => {
  const client = io(SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  clients.push(client);

  const stats = await waitForEvent(client, "connection-stats", {
    windowMs: 5000,
  });
  client.close();

  assert.notEqual(stats, null, "expected an initial connection-stats push");
  assert.equal(typeof stats.successRate, "number");
  assert.equal(typeof stats.successfulConnections, "number");
});

test("every socket is broadcast the new value when an attempt settles", async () => {
  const a = await connectClient("A");
  const b = await connectClient("B");
  await delay(200);

  const baseline = await readStats();
  const expected = baseline.successfulConnections + 1;
  const over = (s) => s.successfulConnections >= expected;

  const aPush = waitForStats(a, over);
  const bPush = waitForStats(b, over);

  a.emit("connection-attempt", { attemptId: "broadcast-1" });
  a.emit("connection-success", { attemptId: "broadcast-1" });

  const [aStats, bStats] = await Promise.all([aPush, bPush]);
  assert.notEqual(aStats, null, "initiator should receive the broadcast");
  assert.notEqual(bStats, null, "every other socket should receive it too");
  assert.equal(aStats.successfulConnections, bStats.successfulConnections);
});

test("identical attempt ids from different sockets stay independent", async () => {
  const a = await connectClient("A");
  const b = await connectClient("B");
  await delay(200);

  const baseline = await readStats();
  const expectedSuccesses = baseline.successfulConnections + 2;

  const push = waitForStats(
    a,
    (s) => s.successfulConnections >= expectedSuccesses,
  );

  a.emit("connection-attempt", { attemptId: 1 });
  b.emit("connection-attempt", { attemptId: 1 });
  await delay(300);

  const inFlight = await readStats();
  assert.equal(
    inFlight.totalConnectionAttempts,
    baseline.totalConnectionAttempts + 2,
    "both sockets' attempts must be counted",
  );

  a.emit("connection-success", { attemptId: 1 });
  b.emit("connection-success", { attemptId: 1 });

  const settled = await push;
  assert.notEqual(settled, null, "both attempts should resolve");
  assert.equal(
    settled.successfulConnections,
    expectedSuccesses,
    "a colliding id on another socket must not swallow an outcome",
  );
});

test("a socket cannot settle another socket's or an unknown attempt", async () => {
  const a = await connectClient("A");
  const b = await connectClient("B");
  await delay(200);

  b.emit("connection-attempt", { attemptId: 7 });
  await delay(300);
  const before = await readStats();

  a.emit("connection-success", { attemptId: 7 });
  a.emit("connection-user-failed", { attemptId: 7 });
  a.emit("connection-user-failed", { attemptId: "never-started" });
  await delay(500);

  const after = await readStats();
  assert.equal(
    after.resolvedConnections,
    before.resolvedConnections,
    "another socket's attempt must not be resolvable",
  );
  assert.equal(after.successfulConnections, before.successfulConnections);
});

test("a socket that disconnects mid-handshake records a failure", async () => {
  const a = await connectClient("A");
  const observer = await connectClient("observer");
  await delay(200);

  const baseline = await readStats();
  const expectedFailures = baseline.failedConnections + 1;

  const push = waitForStats(
    observer,
    (s) => s.failedConnections >= expectedFailures,
  );

  a.emit("connection-attempt", { attemptId: "abandoned" });
  await delay(200);
  a.close();
  clients = clients.filter((c) => c !== a);

  const settled = await push;
  assert.notEqual(settled, null, "teardown should settle the attempt");
  assert.equal(
    settled.failedConnections,
    expectedFailures,
    "an abandoned attempt must not linger as pending",
  );
});
