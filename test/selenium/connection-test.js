const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require("path");
const { DEFAULT_PORT } = require("../../server/config/constants");

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
  let peer1Id = null;
  let peer2Id = null;
  let testFilePath = null;

  try {
    const testFileName = "test-file-rtcportal.txt";
    const testFileContent = `Test file for RTCPortal P2P Transfer\nCreated at: ${new Date().toISOString()}\nThis file should appear in both peers' transfer history.`;
    testFilePath = path.join(require("os").tmpdir(), testFileName);
    fs.writeFileSync(testFilePath, testFileContent);
    console.log(`Created test file: ${testFilePath}`);

    console.log("Creating WebDriver instances");
    driver1 = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();
    await driver1.manage().setTimeouts({ pageLoad: 30000, implicit: 5000 });

    driver2 = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();
    await driver2.manage().setTimeouts({ pageLoad: 30000, implicit: 5000 });

    const url = process.env.TEST_URL || `http://localhost:${DEFAULT_PORT}`;
    const expectedTitle = "RTCPortal - P2P File Sharing";

    console.log("Setup Peer 1 (Initiator)");
    await driver1.get(url);
    console.log(`Peer 1 navigated to: ${url}`);

    await driver1.wait(until.titleIs(expectedTitle), 15000);
    console.log(`Page Title: ${await driver1.getTitle()}`);

    const myIdDisplay1 = await driver1.wait(
      until.elementLocated(By.id("my-id-display")),
      20000,
    );
    await driver1.wait(async () => {
      const text = await myIdDisplay1.getText();
      return text !== "Waiting for ID" && text !== "" && text.length > 5;
    }, 20000);

    peer1Id = (await myIdDisplay1.getText()).trim();
    console.log(`Peer 1 ID: ${peer1Id}`);

    const copyIdButton1 = await driver1.findElement(By.id("copy-id-btn"));
    await driver1.wait(until.elementIsVisible(copyIdButton1), 20000);
    console.log(`Copy ID button visible`);

    console.log("Setup Peer 2 (Receiver)");
    await driver2.get(url);
    console.log(`Peer 2 navigated to: ${url}`);

    await driver2.wait(until.titleIs(expectedTitle), 20000);
    console.log(`Page Title: ${await driver2.getTitle()}`);

    const myIdDisplay2 = await driver2.wait(
      until.elementLocated(By.id("my-id-display")),
      20000,
    );
    await driver2.wait(async () => {
      const text = await myIdDisplay2.getText();
      return text !== "Waiting for ID" && text !== "" && text.length > 5;
    }, 20000);

    peer2Id = (await myIdDisplay2.getText()).trim();
    console.log(`Peer 2 ID: ${peer2Id}`);

    const copyIdButton2 = await driver2.findElement(By.id("copy-id-btn"));
    await driver2.wait(until.elementIsVisible(copyIdButton2), 20000);
    console.log(`Copy ID button visible`);

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

    const activeConnectionContainer1 = await driver1.findElement(
      By.id("active-connection-container"),
    );
    const activeConnectionStatus1 = await driver1.findElement(
      By.id("active-connection-status"),
    );

    console.log("Waiting for connection");
    await driver1.wait(
      until.elementIsVisible(activeConnectionContainer1),
      30000,
    );
    console.log(`Peer 1 connected`);

    await driver1.wait(async () => {
      const text = (await activeConnectionStatus1.getText()).trim();
      return text === peer2Id;
    }, 30000);
    console.log(`Peer 1 status: Connected to ${peer2Id}`);

    const activeConnectionContainer2 = await driver2.findElement(
      By.id("active-connection-container"),
    );
    const activeConnectionStatus2 = await driver2.findElement(
      By.id("active-connection-status"),
    );

    await driver2.wait(
      until.elementIsVisible(activeConnectionContainer2),
      30000,
    );
    console.log(`Peer 2 connected`);

    await driver2.wait(async () => {
      const text = (await activeConnectionStatus2.getText()).trim();
      return text === peer1Id;
    }, 30000);
    console.log(`Peer 2 status: Connected to ${peer1Id}`);

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
      } catch (e) {
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
      } catch (e) {
        return false;
      }
    }, 45000);
    console.log(`File received on Peer 2`);

    const incomingSection = await driver2.findElement(
      By.id("incoming-section"),
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
