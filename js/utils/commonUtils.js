const appUtils = {
  safeJsonParse(text) {
    if (typeof text !== "string") return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      console.warn("safeJsonParse failed:", error);
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
    const normalizedValue = size / Math.pow(1024, index);

    if (index === 0) {
      return `${Math.round(normalizedValue)} ${units[index]}`;
    }

    return `${normalizedValue.toFixed(2)} ${units[index]}`;
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

  async requestJson(url, options = {}) {
    const { errorPrefix = "Request failed" } = options;

    const response = await fetch(url);

    if (!response.ok) {
      let details = "";
      try {
        const errorData = await response.json();
        details = errorData?.details || errorData?.error || "";
      } catch (error) {
        console.warn("Failed to parse JSON error response:", error);
      }

      const detailSuffix = details ? ` ${details}` : "";
      throw new Error(
        `${errorPrefix}: ${response.status} ${response.statusText}.${detailSuffix}`,
      );
    }

    return response.json();
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
