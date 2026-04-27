const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require("path");
const { DEFAULT_PORT } = require("../../server/config/constants");

async function buildDriver(options) {
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();
  await driver.manage().setTimeouts({ pageLoad: 30000, implicit: 5000 });
  return driver;
}

async function waitForAssignedPeerId(driver) {
  const myIdDisplay = await driver.wait(
    until.elementLocated(By.id("my-id-display")),
    20000,
  );

  await driver.wait(async () => {
    const text = await myIdDisplay.getText();
    return (
      text !== "Waiting for PIN..." &&
      text !== "Waiting for ID..." &&
      text !== "" &&
      text !== "Connection Error" &&
      text.length > 5
    );
  }, 20000);

  const peerId = (await myIdDisplay.getText()).trim();
  return peerId;
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

async function waitForPeerConnection(driver, expectedPeerId, label) {
  const activeConnectionContainer = await driver.findElement(
    By.id("active-connection-container"),
  );
  const activeConnectionStatus = await driver.findElement(
    By.id("active-connection-status"),
  );

  await driver.wait(until.elementIsVisible(activeConnectionContainer), 30000);
  console.log(`${label} connected`);

  await driver.wait(async () => {
    const text = (await activeConnectionStatus.getText()).trim();
    return text === expectedPeerId;
  }, 30000);
  console.log(`${label} status: Connected to ${expectedPeerId}`);
}

async function runConnectionTest() {
  const options = new chrome.Options();
  options.addArguments("--headless");
  options.addArguments("--no-sandbox");
  options.addArguments("--disable-dev-shm-usage");
  options.addArguments("--disable-web-security");
  options.addArguments("--allow-running-insecure-content");
  options.addArguments("--use-fake-ui-for-media-stream");
  options.addArguments("--use-fake-device-for-media-stream");

  let driver1, driver2;
  let testFilePath = null;

  try {
    const testFileName = "test-file-rtcportal.txt";
    const testFileContent = `Test file for RTCPortal P2P Transfer\nCreated at: ${new Date().toISOString()}\nThis file should appear in both peers' transfer history.`;
    testFilePath = path.join(require("os").tmpdir(), testFileName);
    fs.writeFileSync(testFilePath, testFileContent);
    console.log(`Created test file: ${testFilePath}`);

    console.log("Creating WebDriver instances");
    driver1 = await buildDriver(options);
    driver2 = await buildDriver(options);

    const url = process.env.TEST_URL || `http://localhost:${DEFAULT_PORT}`;
    const expectedTitle = "RTCPortal - P2P Transfer Hub";

    const peer1Id = await setupPeer({
      driver: driver1,
      url,
      expectedTitle,
      label: "Peer 1 (Initiator)",
    });
    const peer2Id = await setupPeer({
      driver: driver2,
      url,
      expectedTitle,
      label: "Peer 2 (Receiver)",
    });

    console.log("Establishing P2P Connection");
    const partnerIdField1 = await driver1.findElement(
      By.id("partner-id-field"),
    );
    const connectButton1 = await driver1.findElement(By.id("connect-btn"));

    console.log(`Entering Peer 2 ID: ${peer2Id}`);
    await partnerIdField1.clear();
    await partnerIdField1.sendKeys(peer2Id);

    await driver1.wait(until.elementIsEnabled(connectButton1), 20000);
    console.log(`Connect button enabled`);

    console.log("Clicking Connect button");
    await connectButton1.click();

    console.log("Waiting for connection");
    await waitForPeerConnection(driver1, peer2Id, "Peer 1");
    await waitForPeerConnection(driver2, peer1Id, "Peer 2");

    const fileTransferSection1 = await driver1.findElement(
      By.id("file-transfer-section"),
    );
    const fileTransferSection2 = await driver2.findElement(
      By.id("file-transfer-section"),
    );

    await driver1.wait(until.elementIsVisible(fileTransferSection1), 20000);
    await driver2.wait(until.elementIsVisible(fileTransferSection2), 20000);
    console.log(`File transfer sections visible on both peers`);

    console.log("Testing File Transfer");
    console.log(`Uploading file: ${testFileName}`);

    const fileInput = await driver1.findElement(By.id("upload-field"));
    await fileInput.sendKeys(testFilePath);
    console.log(`File selected`);

    const fileTransferBtn = await driver1.findElement(
      By.id("file-transfer-btn"),
    );
    await driver1.wait(until.elementIsEnabled(fileTransferBtn), 10000);
    console.log(`Send button enabled`);

    await fileTransferBtn.click();
    console.log(`File transfer initiated`);

    console.log(`Waiting for file transfer to complete`);
    await driver1.wait(async () => {
      try {
        const statusDiv = await driver1.findElement(
          By.id("transfer-status-sent"),
        );
        const statusText = await statusDiv.getText();
        return statusText.toLowerCase().includes("sent");
      } catch {
        return false;
      }
    }, 45000);
    console.log(`File transfer completed on Peer 1`);

    console.log(`Checking for received file on Peer 2`);
    await driver2.wait(async () => {
      try {
        const incomingFiles = await driver2.findElement(
          By.id("incoming-files"),
        );
        const filesText = await incomingFiles.getText();
        return filesText.includes(testFileName);
      } catch {
        return false;
      }
    }, 45000);
    console.log(`File received on Peer 2`);

    const incomingSection = await driver2.findElement(
      By.id("incoming-files-section"),
    );
    const incomingText = await incomingSection.getText();

    if (!incomingText.includes(testFileName)) {
      throw new Error(
        `File not found in Peer 2's incoming files: expected ${testFileName}`,
      );
    }
    console.log(`File verified in transfer history`);

    console.log("Test Results:");
    console.log("Both peers connected successfully");
    console.log("File transfer completed");
    console.log("File appears in receiver's history");
    console.log("All tests passed");
  } catch (error) {
    console.error("Test failed:", error.message);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    try {
      if (driver1) {
        console.log("Cleaning up Peer 1");
        await driver1.quit();
      }
      if (driver2) {
        console.log("Cleaning up Peer 2");
        await driver2.quit();
      }
      if (testFilePath && fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
        console.log(`Deleted test file: ${testFilePath}`);
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError.message);
    }
  }
}

runConnectionTest();
