
import { BASE_API_URL } from "./config/constants.js";
import { uiManager } from "./ui/uiManager.js";

const socketIoSrc = `${BASE_API_URL}/socket.io/socket.io.js`;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

(async () => {
  try {
    await loadScript(socketIoSrc);
    await import("./core/webrtcManager.js");
    await import("./core/fileTransferManager.js");
  } catch (error) {
    console.error("Script bootstrap failed:", error);
    const showError = () => {
      if (uiManager) {
        uiManager.showIdError("Unable to load connection scripts");
      } else {
        const statusEl = document.getElementById("status-id-message");
        if (statusEl) {
          statusEl.textContent = "Unable to load connection scripts";
          statusEl.classList.add("visible", "error");
        }
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", showError);
    } else {
      showError();
    }
  }
})();

