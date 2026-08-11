// Shared helpers for RTCPortal Selenium tests.
//
// Provides driver construction, PIN/peer setup, connection waiting, and
// visibility helpers used by both connection-test.js and ui-test.js.

const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { DEFAULT_PORT } = require("../../server/config/constants");

const EXPECTED_TITLE = "RTCPortal - P2P Transfer Hub";

function buildChromeOptions(extra = []) {
  const options = new chrome.Options();
  options.addArguments("--headless");
  options.addArguments("--no-sandbox");
  options.addArguments("--disable-dev-shm-usage");
  options.addArguments("--disable-web-security");
  options.addArguments("--allow-running-insecure-content");
  options.addArguments("--use-fake-ui-for-media-stream");
  options.addArguments("--use-fake-device-for-media-stream");
  for (const arg of extra) options.addArguments(arg);
  return options;
}

async function buildDriver(extra = []) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(buildChromeOptions(extra))
    .build();
  await driver.manage().setTimeouts({ pageLoad: 30000, implicit: 5000 });
  return driver;
}

function getUrl() {
  return process.env.TEST_URL || `http://localhost:${DEFAULT_PORT}`;
}

async function waitForAssignedPeerId(driver, timeout = 20000) {
  const myIdDisplay = await driver.wait(
    until.elementLocated(By.id("my-id-display")),
    timeout,
  );

  await driver.wait(
    async () => {
      const text = await myIdDisplay.getText();
      return (
        text !== "Waiting for PIN..." &&
        text !== "Waiting for ID..." &&
        text !== "" &&
        text !== "Connection Error" &&
        text.length > 5
      );
    },
    timeout,
    "Waiting for a PIN to be assigned",
  );

  return (await myIdDisplay.getText()).trim();
}

async function setupPeer({ driver, url, expectedTitle, label }) {
  console.log(`Setup ${label}`);
  await driver.get(url);
  console.log(`${label} navigated to: ${url}`);

  await driver.wait(until.titleIs(expectedTitle), 20000);
  console.log(`Page Title: ${await driver.getTitle()}`);

  const peerId = await waitForAssignedPeerId(driver);
  console.log(`${label} ID: ${peerId}`);

  const copyIdButton = await driver.findElement(By.id("copy-id-btn"));
  await driver.wait(until.elementIsVisible(copyIdButton), 20000);
  console.log("Copy ID button visible");

  return peerId;
}

// Waits until an element is both present and visible (display != none,
// visibility != hidden, opacity != 0).
async function waitForVisible(
  driver,
  locator,
  timeout = 20000,
  message = "visible",
) {
  const el = await driver.wait(until.elementLocated(locator), timeout);
  await driver.wait(
    async () => {
      try {
        const d = await el.getCssValue("display");
        const v = await el.getCssValue("visibility");
        const o = await el.getCssValue("opacity");
        return d !== "none" && v !== "hidden" && o !== "0";
      } catch {
        return false;
      }
    },
    timeout,
    `Waiting for ${message}`,
  );
  return el;
}

async function waitForPeerConnection(driver, expectedPeerId, label) {
  const container = await waitForVisible(
    driver,
    By.id("active-connection-container"),
    30000,
    "active connection container",
  );

  const status = await driver.findElement(By.id("active-connection-status"));
  await driver.wait(async () => {
    const text = (await status.getText()).trim();
    return text === expectedPeerId;
  }, 30000);
  console.log(`${label} status: Connected to ${expectedPeerId}`);
  return container;
}

// Connects peer1 (initiator) to peer2 (responder) by entering peer2's ID
// and clicking Connect. Waits for both sides to show the connection.
async function connectPeers(driver1, driver2, peer2Id, peer1Id) {
  const partnerIdField1 = await driver1.findElement(By.id("partner-id-field"));
  const connectButton1 = await driver1.findElement(By.id("connect-btn"));

  await partnerIdField1.clear();
  await partnerIdField1.sendKeys(peer2Id);
  await driver1.wait(until.elementIsEnabled(connectButton1), 20000);

  await connectButton1.click();

  console.log("Waiting for connection");
  await waitForPeerConnection(driver1, peer2Id, "Peer 1");
  await waitForPeerConnection(driver2, peer1Id, "Peer 2");
}

// Sends the given file from sender to receiver and verifies it appears in
// the receiver's incoming files.
async function transferFile(
  driverFrom,
  driverTo,
  filePath,
  fileName,
  timeout = 45000,
) {
  const fileInput = await driverFrom.findElement(By.id("upload-field"));
  await fileInput.sendKeys(filePath);
  console.log(`File selected: ${fileName}`);

  const fileTransferBtn = await driverFrom.findElement(
    By.id("file-transfer-btn"),
  );
  await driverFrom.wait(until.elementIsEnabled(fileTransferBtn), 10000);
  await fileTransferBtn.click();
  console.log("File transfer initiated");

  await driverFrom.wait(
    async () => {
      try {
        const statusDiv = await driverFrom.findElement(
          By.id("transfer-status-sent"),
        );
        const text = await statusDiv.getText();
        return text.toLowerCase().includes("sent");
      } catch {
        return false;
      }
    },
    timeout,
    "Waiting for file transfer to complete",
  );
  console.log("File transfer completed on sender");

  await driverTo.wait(
    async () => {
      try {
        const incomingFiles = await driverTo.findElement(
          By.id("incoming-files"),
        );
        const text = await incomingFiles.getText();
        return text.includes(fileName);
      } catch {
        return false;
      }
    },
    timeout,
    `Waiting for ${fileName} on receiver`,
  );
  console.log(`File verified on receiver: ${fileName}`);
}

module.exports = {
  EXPECTED_TITLE,
  buildDriver,
  getUrl,
  waitForAssignedPeerId,
  setupPeer,
  waitForVisible,
  waitForPeerConnection,
  connectPeers,
  transferFile,
  By,
  until,
};
