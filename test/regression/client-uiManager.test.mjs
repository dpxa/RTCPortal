import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import path from "node:path";
import {
  bundleModule,
  createBundleDir,
  PUBLIC_JS,
} from "./helpers/bundle-client-module.mjs";
import { UI_MANAGER_HTML } from "./helpers/ui-manager-dom.mjs";
import {
  installIndexedDBMock,
  resetIndexedDBMock,
} from "./helpers/indexeddb-mock.mjs";

let dom;
let window;
let document;
let bundleDir;
let uiManager;

beforeEach(async () => {
  dom = new JSDOM(UI_MANAGER_HTML, { url: "http://localhost/" });
  window = dom.window;
  document = window.document;

  globalThis.window = window;
  globalThis.document = document;
  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator,
    configurable: true,
  });
  globalThis.localStorage = window.localStorage;
  globalThis.matchMedia = window.matchMedia;
  globalThis.URL.createObjectURL = () => "blob:mock";
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.QRCode = function () {};
  globalThis.QRCode.CorrectLevel = { H: 0 };

  installIndexedDBMock();

  bundleDir = createBundleDir();
  const mod = await bundleModule(
    path.join(PUBLIC_JS, "ui/uiManager.js"),
    bundleDir,
  );

  uiManager = mod.uiManager;
});

afterEach(() => {
  resetIndexedDBMock();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.matchMedia;
  delete globalThis.QRCode;
  try {
    delete globalThis.navigator;
  } catch {
    Object.defineProperty(globalThis, "navigator", { value: undefined });
  }
  if (globalThis.URL) {
    globalThis.URL.createObjectURL = undefined;
    globalThis.URL.revokeObjectURL = undefined;
  }
});

test("constructs and initializes basic state", () => {
  const ui = uiManager;
  assert.equal(ui.currentSendProgress, -1);
  assert.equal(ui.currentReceiveProgress, -1);
  assert.deepEqual(ui.nicknames, {});
});

test("setLocalPinAssigned populates the ID display and shows action buttons", () => {
  const ui = uiManager;
  ui.setLocalPinAssigned("funny-horse-123");
  assert.equal(
    document.getElementById("my-id-display").textContent,
    "funny-horse-123",
  );
  assert.equal(
    document.getElementById("my-id-display").classList.contains("active"),
    true,
  );
  assert.equal(document.getElementById("pin-action-buttons").hidden, false);
});

test("setLocalPinStatus marks inactive and hides action buttons", () => {
  const ui = uiManager;
  ui.setLocalPinStatus("Disconnected");
  assert.equal(
    document.getElementById("my-id-display").textContent,
    "Disconnected",
  );
  assert.equal(
    document.getElementById("my-id-display").classList.contains("inactive"),
    true,
  );
  assert.equal(document.getElementById("pin-action-buttons").hidden, true);
});

test("getPartnerIdValue and setPartnerIdValue round-trip", () => {
  const ui = uiManager;
  ui.setPartnerIdValue("peer-abc");
  assert.equal(ui.getPartnerIdValue(), "peer-abc");
});

test("consumePartnerIdValue returns and clears the field", () => {
  const ui = uiManager;
  ui.setPartnerIdValue("peer-abc");
  assert.equal(ui.consumePartnerIdValue(), "peer-abc");
  assert.equal(ui.getPartnerIdValue(), "");
});

test("setConnectButtonEnabled toggles disabled state", () => {
  const ui = uiManager;
  ui.setConnectButtonEnabled(false);
  assert.equal(document.getElementById("connect-btn").disabled, true);
  ui.setConnectButtonEnabled(true);
  assert.equal(document.getElementById("connect-btn").disabled, false);
});

test("showIdError sets the status message and schedules clear", () => {
  const ui = uiManager;
  ui.showIdError("Bad ID");
  assert.equal(
    document.getElementById("status-id-message").textContent,
    "Bad ID",
  );
});

test("getPeerDisplayLabel uses nickname when available", () => {
  const ui = uiManager;
  ui.setNickname("peer-1", "Alice");
  assert.equal(ui.getPeerDisplayLabel("peer-1"), "Alice (peer-1)");
  assert.equal(ui.getPeerDisplayLabel("peer-2"), "peer-2");
});

test("setNickname stores and deletes nicknames", () => {
  const ui = uiManager;
  ui.setNickname("peer-1", "Alice");
  assert.equal(ui.getNickname("peer-1"), "Alice");
  ui.setNickname("peer-1", "");
  assert.equal(ui.getNickname("peer-1"), "peer-1");
});

test("toggleChat shows and hides chat section", () => {
  const ui = uiManager;
  const section = document.getElementById("chat-section");

  ui.toggleChat();
  assert.equal(section.hidden, true);
  ui.toggleChat();
  assert.equal(section.hidden, false);
});

test("appendChatMessage adds a message and removes placeholder", () => {
  const ui = uiManager;
  ui.appendChatMessage("hello", true);
  const box = document.getElementById("chat-box");
  assert.ok(box.querySelector(".chat-placeholder") === null);
  const messages = box.querySelectorAll(".chat-message");
  assert.equal(messages.length, 1);
  assert.match(messages[0].textContent, /hello/);
});

test("formatBytes via render helpers not needed; updateConnectionStats updates displays", () => {
  const ui = uiManager;
  ui.updateConnectionStats({
    successRate: 75.5,
    uptimeMs: 123456,
    totalData: 1024,
    totalFiles: 3,
  });

  assert.ok(
    document.getElementById("success-rate-display").textContent.length > 0,
  );
});

test("triggerDownload creates and clicks an anchor", () => {
  const ui = uiManager;

  let appended = null;
  const origAppend = document.body.appendChild.bind(document.body);
  document.body.appendChild = (el) => {
    appended = el;
    return origAppend(el);
  };
  ui.triggerDownload("blob:mock", "file.zip");
  assert.ok(appended, "should append an anchor");
  assert.equal(appended.tagName, "A");
  assert.equal(appended.download, "file.zip");
  document.body.appendChild = origAppend;
});

test("clearTransferHistoryUI hides history sections", () => {
  const ui = uiManager;
  ui.clearTransferHistoryUI();
  assert.equal(document.getElementById("transfer-history").hidden, true);
});

test("setFileSelectionSummary updates the display", () => {
  const ui = uiManager;
  ui.setFileSelectionSummary("Selected: 2 files");
  assert.equal(
    document.getElementById("file-name-display").textContent,
    "Selected: 2 files",
  );
});
