const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function runConnectionTest() {
    const options = new chrome.Options();
    options.addArguments('--headless');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-web-security');
    options.addArguments('--allow-running-insecure-content');

    let driver1, driver2;
    let peer1Id = null;
    let peer2Id = null;

    try {
        console.log('Creating WebDriver instances...');
        driver1 = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        await driver1.manage().setTimeouts({ pageLoad: 30000 });
        
        driver2 = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
        await driver2.manage().setTimeouts({ pageLoad: 30000 });

        const url = 'https://dpxa.github.io/RTCPortal/';
        const expectedTitle = 'RTCPortal - P2P File Sharing';

        // Setup Peer 1 (Initiator)
        console.log('Setting up Peer 1 (Initiator)');
        await driver1.get(url);
        console.log(`Peer 1 navigated to: ${url}`);

        await driver1.wait(until.titleIs(expectedTitle), 15000);
        console.log(`Peer 1 Page Title: ${await driver1.getTitle()}`);

        const myIdDisplay1 = await driver1.wait(until.elementLocated(By.id('my-id-display')), 20000);
        await driver1.wait(async () => {
            const text = await myIdDisplay1.getText();
            return text !== 'Waiting for ID' && text !== '';
        }, 20000);
        
        peer1Id = await myIdDisplay1.getText();
        console.log(`Peer 1 'Your ID': ${peer1Id}`);

        const copyIdButton1 = await driver1.findElement(By.id('copy-id-btn'));
        await driver1.wait(until.elementIsVisible(copyIdButton1), 20000);
        console.log(`Peer 1 'Copy My ID' button visible: ${await copyIdButton1.isDisplayed()}`);

        // Setup Peer 2 (Receiver)
        console.log('\nSetting up Peer 2 (Receiver)');
        await driver2.get(url);
        console.log(`Peer 2 navigated to: ${url}`);

        await driver2.wait(until.titleIs(expectedTitle), 20000);
        console.log(`Peer 2 Page Title: ${await driver2.getTitle()}`);

        const myIdDisplay2 = await driver2.wait(until.elementLocated(By.id('my-id-display')), 20000);
        await driver2.wait(async () => {
            const text = await myIdDisplay2.getText();
            return text !== 'Waiting for ID' && text !== '';
        }, 20000);
        
        peer2Id = await myIdDisplay2.getText();
        console.log(`Peer 2 'Your ID': ${peer2Id}`);

        const copyIdButton2 = await driver2.findElement(By.id('copy-id-btn'));
        await driver2.wait(until.elementIsVisible(copyIdButton2), 20000);
        console.log(`Peer 2 'Copy My ID' button visible: ${await copyIdButton2.isDisplayed()}`);

        // Peer 1 connecting to Peer 2
        console.log('\nPeer 1 connecting to Peer 2');
        const partnerIdField1 = await driver1.findElement(By.id('partner-id-field'));
        const connectButton1 = await driver1.findElement(By.id('connect-btn'));

        console.log(`Peer 1 'Connect' button initial enabled state: ${await connectButton1.isEnabled()}`);
        await partnerIdField1.sendKeys(peer2Id);
        console.log(`Peer 1 entered Peer 2's ID (${peer2Id}) into partner ID field.`);
        
        await driver1.wait(until.elementIsEnabled(connectButton1), 20000);
        console.log(`Peer 1 'Connect' button enabled after entering Peer 2's ID: ${await connectButton1.isEnabled()}`);

        console.log('Peer 1 clicking \'Connect\' button.');
        await connectButton1.click();

        // Verify connection status
        console.log('\nVerifying connection status');

        // Peer 1 verification
        const activeConnectionContainer1 = await driver1.findElement(By.id('active-connection-container'));
        const activeConnectionStatus1 = await driver1.findElement(By.id('active-connection-status'));
        const endButton1 = await driver1.findElement(By.id('end-btn'));
        const fileTransferSection1 = await driver1.findElement(By.id('file-transfer-section'));

        await driver1.wait(until.elementIsVisible(activeConnectionContainer1), 30000);
        console.log(`Peer 1 'Active Connection Container' visible: ${await activeConnectionContainer1.isDisplayed()}`);
        
        await driver1.wait(until.elementTextContains(activeConnectionStatus1, peer2Id), 30000);
        console.log(`Peer 1 'Active Connection Status' shows Peer 2's ID: ${await activeConnectionStatus1.getText()}`);
        
        await driver1.wait(until.elementIsVisible(endButton1), 15000);
        await driver1.wait(until.elementTextIs(endButton1, 'DISCONNECT'), 15000);
        console.log(`Peer 1 'End' button visible and text is 'DISCONNECT': ${await endButton1.isDisplayed()} | ${await endButton1.getText()}`);
        
        await driver1.wait(until.elementIsVisible(fileTransferSection1), 20000);
        console.log(`Peer 1 'File Transfer Section' visible: ${await fileTransferSection1.isDisplayed()}`);

        // Peer 2 verification
        const activeConnectionContainer2 = await driver2.findElement(By.id('active-connection-container'));
        const activeConnectionStatus2 = await driver2.findElement(By.id('active-connection-status'));
        const endButton2 = await driver2.findElement(By.id('end-btn'));
        const fileTransferSection2 = await driver2.findElement(By.id('file-transfer-section'));

        await driver2.wait(until.elementIsVisible(activeConnectionContainer2), 30000);
        console.log(`Peer 2 'Active Connection Container' visible: ${await activeConnectionContainer2.isDisplayed()}`);
        
        await driver2.wait(until.elementTextContains(activeConnectionStatus2, peer1Id), 30000);
        console.log(`Peer 2 'Active Connection Status' shows Peer 1's ID: ${await activeConnectionStatus2.getText()}`);
        
        await driver2.wait(until.elementIsVisible(endButton2), 15000);
        await driver2.wait(until.elementTextIs(endButton2, 'DISCONNECT'), 15000);
        console.log(`Peer 2 'End' button visible and text is 'DISCONNECT': ${await endButton2.isDisplayed()} | ${await endButton2.getText()}`);
        
        await driver2.wait(until.elementIsVisible(fileTransferSection2), 20000);
        console.log(`Peer 2 'File Transfer Section' visible: ${await fileTransferSection2.isDisplayed()}`);

        // Final verification
        const peer1Status = await activeConnectionStatus1.getText();
        const peer2Status = await activeConnectionStatus2.getText();
        
        if (peer1Status === peer2Id && peer2Status === peer1Id) {
            console.log('\nConnection established successfully between Peer 1 and Peer 2!');
        } else {
            console.log('\nConnection verification FAILED!');
            process.exit(1);
        }

        const githubLink1 = await driver1.findElement(By.className('repo-link'));
        console.log(`Peer 1 - Found GitHub link with text: '${await githubLink1.getText()}' and href: ${await githubLink1.getAttribute('href')}`);

        console.log('\nAutomated two-peer connection test completed successfully.');

    } catch (error) {
        console.error('Test failed:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    } finally {
        try {
            if (driver1) await driver1.quit();
            if (driver2) await driver2.quit();
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }
    }
}

runConnectionTest();
