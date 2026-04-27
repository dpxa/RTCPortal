const socketIoSrc = `${BASE_API_URL}/socket.io/socket.io.js`;

function loadScript(options) {
  const { src, target } = options;

  return new Promise((resolve, reject) => {
    try {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;

      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));

      if (target === "body") {
        document.body.appendChild(script);
      } else {
        document.head.appendChild(script);
      }
    } catch (error) {
      reject(error);
    }
  });
}

(async () => {
  try {
    await loadScript({ src: socketIoSrc, target: "head" });
    await loadScript({ src: "js/core/webrtcManager.js", target: "body" });
    await loadScript({ src: "js/core/fileTransferManager.js", target: "body" });
  } catch (error) {
    console.error("Script bootstrap failed:", error);
    if (window.uiManager) {
      window.uiManager.showIdError("Unable to load connection scripts.");
    }
  }
})();
