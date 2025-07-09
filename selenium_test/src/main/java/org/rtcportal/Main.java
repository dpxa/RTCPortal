package org.rtcportal;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.By;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

public class Main {

    public static void main(String[] args) {
        System.setProperty("webdriver.chrome.driver", "C:\\WebDriver\\bin\\chromedriver.exe");

        ChromeOptions options = new ChromeOptions();
        options.setBinary("C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe");

        WebDriver driver1 = new ChromeDriver(options);
        WebDriver driver2 = new ChromeDriver(options);

        WebDriverWait wait1 = new WebDriverWait(driver1, Duration.ofSeconds(20));
        WebDriverWait wait2 = new WebDriverWait(driver2, Duration.ofSeconds(20));

        String peer1Id = null;
        String peer2Id = null;

        try {
            String url = "https://dpxa.github.io/RTCPortal/";

            System.out.println("Setting up Peer 1 (Initiator)");
            driver1.get(url);
            System.out.println("Peer 1 navigated to: " + url);

            String expectedTitle = "RTCPortal - P2P File Sharing";
            wait1.until(ExpectedConditions.titleIs(expectedTitle));
            System.out.println("Peer 1 Page Title: " + driver1.getTitle());

            WebElement myIdDisplay1 = wait1.until(ExpectedConditions.visibilityOfElementLocated(By.id("myIdDisplay")));
            wait1.until(driverLambda -> {
                String text = myIdDisplay1.getText();
                return !text.equals("Waiting for ID") && !text.isEmpty();
            });
            peer1Id = myIdDisplay1.getText();
            System.out.println("Peer 1 'Your ID': " + peer1Id);
            WebElement copyIdButton1 = driver1.findElement(By.id("copyIdTrigger"));
            wait1.until(ExpectedConditions.visibilityOf(copyIdButton1));
            System.out.println("Peer 1 'Copy My ID' button visible: " + copyIdButton1.isDisplayed());

            System.out.println("\nSetting up Peer 2 (Receiver)");
            driver2.get(url);
            System.out.println("Peer 2 navigated to: " + url);

            wait2.until(ExpectedConditions.titleIs(expectedTitle));
            System.out.println("Peer 2 Page Title: " + driver2.getTitle());

            WebElement myIdDisplay2 = wait2.until(ExpectedConditions.visibilityOfElementLocated(By.id("myIdDisplay")));
            wait2.until(driverLambda -> {
                String text = myIdDisplay2.getText();
                return !text.equals("Waiting for ID") && !text.isEmpty();
            });
            peer2Id = myIdDisplay2.getText();
            System.out.println("Peer 2 'Your ID': " + peer2Id);
            WebElement copyIdButton2 = driver2.findElement(By.id("copyIdTrigger"));
            wait2.until(ExpectedConditions.visibilityOf(copyIdButton2));
            System.out.println("Peer 2 'Copy My ID' button visible: " + copyIdButton2.isDisplayed());

            System.out.println("\nPeer 1 connecting to Peer 2");
            WebElement partnerIdField1 = driver1.findElement(By.id("partnerIdField"));
            WebElement connectButton1 = driver1.findElement(By.id("connectTrigger"));

            System.out.println("Peer 1 'Connect' button initial enabled state: " + connectButton1.isEnabled());
            partnerIdField1.sendKeys(peer2Id);
            System.out.println("Peer 1 entered Peer 2's ID (" + peer2Id + ") into partner ID field.");
            wait1.until(ExpectedConditions.elementToBeClickable(connectButton1));
            System.out.println("Peer 1 'Connect' button enabled after entering Peer 2's ID: " + connectButton1.isEnabled());

            System.out.println("Peer 1 clicking 'Connect' button.");
            connectButton1.click();

            System.out.println("\nVerifying connection status");

            WebElement activeConnectionContainer1 = driver1.findElement(By.id("activeConnectionContainer"));
            WebElement activeConnectionStatus1 = driver1.findElement(By.id("activeConnectionStatus"));
            WebElement endButton1 = driver1.findElement(By.id("endTrigger"));
            WebElement fileTransferSection1 = driver1.findElement(By.id("fileTransferSection"));

            wait1.until(ExpectedConditions.visibilityOf(activeConnectionContainer1));
            System.out.println("Peer 1 'Active Connection Container' visible: " + activeConnectionContainer1.isDisplayed());
            wait1.until(ExpectedConditions.textToBePresentInElement(activeConnectionStatus1, peer2Id));
            System.out.println("Peer 1 'Active Connection Status' shows Peer 2's ID: " + activeConnectionStatus1.getText());
            wait1.until(ExpectedConditions.visibilityOf(endButton1));
            wait1.until(ExpectedConditions.textToBePresentInElement(endButton1, "DISCONNECT"));
            System.out.println("Peer 1 'End' button visible and text is 'DISCONNECT': " + endButton1.isDisplayed() + " | " + endButton1.getText());
            wait1.until(ExpectedConditions.visibilityOf(fileTransferSection1));
            System.out.println("Peer 1 'File Transfer Section' visible: " + fileTransferSection1.isDisplayed());

            WebElement activeConnectionContainer2 = driver2.findElement(By.id("activeConnectionContainer"));
            WebElement activeConnectionStatus2 = driver2.findElement(By.id("activeConnectionStatus"));
            WebElement endButton2 = driver2.findElement(By.id("endTrigger"));
            WebElement fileTransferSection2 = driver2.findElement(By.id("fileTransferSection"));

            wait2.until(ExpectedConditions.visibilityOf(activeConnectionContainer2));
            System.out.println("Peer 2 'Active Connection Container' visible: " + activeConnectionContainer2.isDisplayed());
            wait2.until(ExpectedConditions.textToBePresentInElement(activeConnectionStatus2, peer1Id));
            System.out.println("Peer 2 'Active Connection Status' shows Peer 1's ID: " + activeConnectionStatus2.getText());
            wait2.until(ExpectedConditions.visibilityOf(endButton2));
            wait2.until(ExpectedConditions.textToBePresentInElement(endButton2, "DISCONNECT"));
            System.out.println("Peer 2 'End' button visible and text is 'DISCONNECT': " + endButton2.isDisplayed() + " | " + endButton2.getText());
            wait2.until(ExpectedConditions.visibilityOf(fileTransferSection2));
            System.out.println("Peer 2 'File Transfer Section' visible: " + fileTransferSection2.isDisplayed());

            if (activeConnectionStatus1.getText().equals(peer2Id) && activeConnectionStatus2.getText().equals(peer1Id)) {
                System.out.println("\nConnection established successfully between Peer 1 and Peer 2!");
            } else {
                System.out.println("\nConnection verification FAILED!");
            }

            WebElement githubLink1 = driver1.findElement(By.className("repo-link"));
            System.out.println("Peer 1 - Found GitHub link with text: '" + githubLink1.getText() + "' and href: " + githubLink1.getAttribute("href"));

            System.out.println("\nAutomated two-peer connection test completed.");

        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            if (driver1 != null) {
                driver1.quit();
            }
            if (driver2 != null) {
                driver2.quit();
            }
        }
    }
}