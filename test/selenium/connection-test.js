const fs = require("fs");
const path = require("path");
const {
  EXPECTED_TITLE,
  buildDriver,
  getUrl,
  setupPeer,
  waitForVisible,
  connectPeers,
  transferFile,
  By,
  until,
} = require("./helpers");

async function sendChatMessage(driver, text) {
  const chatInput = await driver.findElement(By.id("chat-input"));
  await chatInput.clear();
  await chatInput.sendKeys(text);
  const sendBtn = await driver.findElement(By.id("send-chat-btn"));
  await sendBtn.click();
}

async function verifyChatMessage(driver, text) {
  await driver.wait(
    async () => {
      const chatBox = await driver.findElement(By.id("chat-box"));
      const content = await chatBox.getText();
      return content.includes(text);
    },
    15000,
    `Waiting for chat message: ${text}`,
  );
  console.log(`Chat message verified: ${text}`);
}

async function runConnectionTest() {
  let driver1, driver2;
  let testFilePath = null;
  let testFilePath2 = null;

  try {
    const url = getUrl();
    const testFileName = "test-file-rtcportal.txt";
    const testFileContent = `Test file for RTCPortal P2P Transfer\nCreated at: ${new Date().toISOString()}\nThis file should appear in both peers' transfer history.`;
    testFilePath = path.join(require("os").tmpdir(), testFileName);
    fs.writeFileSync(testFilePath, testFileContent);

    const testFileName2 = "test-file-reverse.txt";
    const testFileContent2 = `Reverse file for RTCPortal P2P Transfer\nCreated at: ${new Date().toISOString()}\nThis verifies reverse direction transfers.`;
    testFilePath2 = path.join(require("os").tmpdir(), testFileName2);
    fs.writeFileSync(testFilePath2, testFileContent2);

    console.log("Creating WebDriver instances");
    driver1 = await buildDriver();
    driver2 = await buildDriver();

    const peer1Id = await setupPeer({
      driver: driver1,
      url,
      expectedTitle: EXPECTED_TITLE,
      label: "Peer 1 (Initiator)",
    });
    const peer2Id = await setupPeer({
      driver: driver2,
      url,
      expectedTitle: EXPECTED_TITLE,
      label: "Peer 2 (Receiver)",
    });

    console.log("Establishing P2P Connection");
    await connectPeers(driver1, driver2, peer2Id, peer1Id);

    await waitForVisible(
      driver1,
      By.id("file-transfer-section"),
      20000,
      "file transfer section on Peer 1",
    );
    await waitForVisible(
      driver2,
      By.id("file-transfer-section"),
      20000,
      "file transfer section on Peer 2",
    );
    console.log("File transfer sections visible on both peers");

    console.log("Testing chat both directions");
    const chatToggle1 = await driver1.findElement(By.id("toggle-chat-btn"));
    await driver1.wait(until.elementIsVisible(chatToggle1), 10000);
    await driver1.executeScript(
      "document.getElementById('toggle-chat-btn').click()",
    );

    const chatToggle2 = await driver2.findElement(By.id("toggle-chat-btn"));
    await driver2.wait(until.elementIsVisible(chatToggle2), 10000);
    await driver2.executeScript(
      "document.getElementById('toggle-chat-btn').click()",
    );

    await sendChatMessage(driver1, "hello from peer1");
    await verifyChatMessage(driver2, "hello from peer1");
    await sendChatMessage(driver2, "hi peer2 here");
    await verifyChatMessage(driver1, "hi peer2 here");
    console.log("Chat round-trip verified");

    console.log("Testing File Transfer (Peer 1 -> Peer 2)");
    await transferFile(driver1, driver2, testFilePath, testFileName);

    const incomingSection = await driver2.findElement(
      By.id("incoming-files-section"),
    );
    await driver2.wait(until.elementIsVisible(incomingSection), 20000);
    const incomingText = await incomingSection.getText();
    if (!incomingText.includes(testFileName)) {
      throw new Error(
        `File not found in Peer 2's incoming files: expected ${testFileName}`,
      );
    }
    console.log("File verified in receiver history");

    console.log("Testing File Transfer (Peer 2 -> Peer 1)");
    await transferFile(driver2, driver1, testFilePath2, testFileName2);

    const incomingSection1 = await driver1.findElement(
      By.id("incoming-files-section"),
    );
    const outgoingText1 = await incomingSection1.getText();
    if (!outgoingText1.includes(testFileName2)) {
      throw new Error(
        `File not found in Peer 1's incoming files: expected ${testFileName2}`,
      );
    }
    console.log("Reverse file verified in receiver history");

    console.log("Testing disconnect");
    const endBtn = await driver1.findElement(By.id("end-btn"));
    await driver1.wait(until.elementIsVisible(endBtn), 10000);
    await endBtn.click();

    console.log("Test Results:");
    console.log("Both peers connected successfully");
    console.log("File transfer completed in both directions");
    console.log("Chat round-trip verified");
    console.log("Files appear in receiver history");
    console.log("All tests passed");
  } catch (error) {
    console.error("Test failed:", error.message);
    try {
      const logs1 = await driver1.manage().logs().get("browser");
      console.log("Driver 1 Logs:", logs1);
    } catch (e) {}
    try {
      const logs2 = await driver2.manage().logs().get("browser");
      console.log("Driver 2 Logs:", logs2);
    } catch (e) {}
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
      }
      if (testFilePath2 && fs.existsSync(testFilePath2)) {
        fs.unlinkSync(testFilePath2);
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError.message);
    }
  }
}

runConnectionTest();
