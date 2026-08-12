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
