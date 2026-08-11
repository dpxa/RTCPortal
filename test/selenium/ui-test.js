// Single-peer UI test for RTCPortal.
//
// Covers frontend UI behaviors that don't require a second peer: theme
// toggle, QR code generation, invalid input handling, file input presence,
// and page refresh. Uses one headless Chrome instance.
//
// Usage:
//   TEST_URL=http://localhost:3000 node selenium/ui-test.js

const {
  EXPECTED_TITLE,
  buildDriver,
  getUrl,
  setupPeer,
  By,
  until,
} = require("./helpers");

async function runUITest() {
  let driver;

  try {
    const url = getUrl();
    driver = await buildDriver();

    const peerId = await setupPeer({
      driver,
      url,
      expectedTitle: EXPECTED_TITLE,
      label: "UI Peer",
    });
    console.log(`UI Peer ID: ${peerId}`);

    // 1. Theme toggle: click toggles dark-mode class on body.
    console.log("Testing theme toggle");
    const themeToggle = await driver.findElement(By.id("theme-toggle"));
    const bodyClassBefore = await driver
      .findElement(By.tagName("body"))
      .getAttribute("class");
    await themeToggle.click();
    await driver.wait(async () => {
      const cls = await driver
        .findElement(By.tagName("body"))
        .getAttribute("class");
      return (
        cls.includes("dark-mode") !== bodyClassBefore.includes("dark-mode")
      );
    }, 10000);
    const bodyClassAfter = await driver
      .findElement(By.tagName("body"))
      .getAttribute("class");
    console.log(
      `Theme toggled: dark-mode before=${bodyClassBefore.includes("dark-mode")}, after=${bodyClassAfter.includes("dark-mode")}`,
    );

    // 2. QR code: clicking show-qr-btn renders a canvas in qr-code-container.
    console.log("Testing QR code generation");
    const showQrBtn = await driver.findElement(By.id("show-qr-btn"));
    await showQrBtn.click();
    await driver.wait(async () => {
      const container = await driver.findElement(By.id("qr-code-container"));
      const canvases = await container.findElements(By.tagName("canvas"));
      return canvases.length > 0;
    }, 10000);
    console.log("QR code canvas rendered");
    // Toggle back off.
    await showQrBtn.click();

    // 3. Invalid partner ID handling: entering a bad ID and connecting
    //    should show an error message (not crash).
    console.log("Testing invalid partner ID");
    const partnerField = await driver.findElement(By.id("partner-id-field"));
    const connectBtn = await driver.findElement(By.id("connect-btn"));
    await partnerField.clear();
    await partnerField.sendKeys("bad id with spaces!!");
    await driver.wait(until.elementIsEnabled(connectBtn), 10000);
    await connectBtn.click();
    await driver.wait(async () => {
      const status = await driver.findElement(By.id("status-id-message"));
      const text = await status.getText();
      return text.length > 0;
    }, 10000);
    console.log("Invalid ID produced a status message");

    // 4. File selection is covered by connection-test.js (which has an active
    //    connection). Here we only verify the upload input is present in the
    //    DOM (it lives in the hidden-until-connected transfer section).
    console.log("Testing file input presence");
    await driver.findElement(By.id("upload-field"));
    console.log("File upload input present in DOM");

    // 5. History persistence: after a refresh, the page reloads cleanly and
    //    a new PIN is assigned (no crash).
    console.log("Testing page refresh");
    await driver.navigate().refresh();
    await driver.wait(until.titleIs(EXPECTED_TITLE), 20000);
    const newPeerId = await setupPeer({
      driver,
      url,
      expectedTitle: EXPECTED_TITLE,
      label: "UI Peer (after refresh)",
    });
    console.log(`New PIN after refresh: ${newPeerId}`);

    console.log("UI Test Results:");
    console.log("Theme toggle works");
    console.log("QR code renders");
    console.log("Invalid ID handled");
    console.log("File upload input present");
    console.log("Page refresh works");
    console.log("All UI tests passed");
  } catch (error) {
    console.error("UI Test failed:", error.message);
    try {
      const logs = await driver.manage().logs().get("browser");
      console.log("Browser logs:", logs);
    } catch (e) {}
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    try {
      if (driver) {
        console.log("Cleaning up UI Peer");
        await driver.quit();
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError.message);
    }
  }
}

runUITest();
