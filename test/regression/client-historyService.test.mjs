// Unit tests for public/js/services/historyService.js
//
// The module exports a singleton that calls init() (indexedDB.open) at
// import time. We install an in-memory IndexedDB mock, then load the module
// via a unique temp fixture per test to avoid ESM caching and shared state.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import {
  installIndexedDBMock,
  resetIndexedDBMock,
} from "./helpers/indexeddb-mock.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(
  __dirname,
  "../../public/js/services/historyService.js",
);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtcportal-history-"));

let loadCounter = 0;
let historyService;

async function loadService() {
  const dest = path.join(tempDir, `history-${loadCounter++}.mjs`);
  fs.copyFileSync(SRC, dest);
  const mod = await import(pathToFileURL(dest).href);
  return mod.historyService;
}

beforeEach(async () => {
  installIndexedDBMock();
  historyService = await loadService();
  await historyService.initPromise;
});

afterEach(() => {
  resetIndexedDBMock();
});

test("addRecord stores a record with a timestamp", async () => {
  const id = await historyService.addRecord({ direction: "from", batch: [] });
  assert.equal(typeof id, "number");
  const history = await historyService.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].direction, "from");
  assert.equal(typeof history[0].timestamp, "number");
});

test("getHistory returns newest-first", async () => {
  await historyService.addRecord({
    direction: "from",
    batch: [],
    timestamp: 1,
  });
  await historyService.addRecord({ direction: "to", batch: [], timestamp: 2 });
  const history = await historyService.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].direction, "to"); // newest first
});

test("addChatRecord and getChatHistory round-trip", async () => {
  await historyService.addChatRecord({
    text: "hi",
    isSelf: true,
    peerId: "p1",
  });
  await historyService.addChatRecord({
    text: "yo",
    isSelf: false,
    peerId: "p1",
  });
  const chat = await historyService.getChatHistory();
  assert.equal(chat.length, 2);
  assert.equal(chat[0].text, "hi");
  assert.equal(chat[1].text, "yo");
});

test("clearHistory clears both transfers and chat stores", async () => {
  await historyService.addRecord({ direction: "from", batch: [] });
  await historyService.addChatRecord({ text: "hi", isSelf: true });
  await historyService.clearHistory();
  assert.equal((await historyService.getHistory()).length, 0);
  assert.equal((await historyService.getChatHistory()).length, 0);
});

test("clearChatHistory clears only the chat store", async () => {
  await historyService.addRecord({ direction: "from", batch: [] });
  await historyService.addChatRecord({ text: "hi", isSelf: true });
  await historyService.clearChatHistory();
  assert.equal((await historyService.getHistory()).length, 1);
  assert.equal((await historyService.getChatHistory()).length, 0);
});

test("getHistory returns [] when db is not initialized", async () => {
  // Force db to null to exercise the guard branch.
  historyService.db = null;
  const history = await historyService.getHistory();
  assert.deepEqual(history, []);
});
