const appUtils = {
  safeJsonParse(text) {
    if (typeof text !== "string") return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  },

  formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size <= 0) return "0 Bytes";

    const units = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
    const index = Math.min(
      units.length - 1,
      Math.floor(Math.log(size) / Math.log(1024)),
    );

    return `${(size / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
  },

  formatUptime(milliseconds) {
    const totalSeconds = Math.floor((Number(milliseconds) || 0) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days !== 1 ? "s" : ""}`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? "s" : ""}`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    return `${totalSeconds} second${totalSeconds !== 1 ? "s" : ""}`;
  },

  wait(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, Number(milliseconds) || 0));
    });
  },

  isPageHidden() {
    try {
      return document.hidden;
    } catch (error) {
      return false;
    }
  },
};

window.appUtils = appUtils;
