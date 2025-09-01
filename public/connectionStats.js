const successRateDisplay = document.getElementById("success-rate-display");
const uptimeDisplay = document.getElementById("uptime-display");

async function fetchConnectionStats() {
  try {
    const baseApiUrl = environmentIsProd
      ? "https://rtcportal.onrender.com"
      : "";
    const apiUrl = `${baseApiUrl}/api/connection-stats`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch stats: ${response.status}`);
    }

    const stats = await response.json();
    updateStatsDisplay(stats);
  } catch (error) {
    console.error("Error fetching connection stats:", error);
    showStatsError();
  }
}

function updateStatsDisplay(stats) {
  successRateDisplay.textContent = `${stats.successRate}%`;
  uptimeDisplay.textContent = `${stats.uptimeHours} hours`;

  // Color code success rate
  if (stats.successRate >= 80) {
    successRateDisplay.style.color = "#27ae60";
  } else if (stats.successRate >= 60) {
    successRateDisplay.style.color = "#f39c12";
  } else {
    successRateDisplay.style.color = "#e74c3c";
  }
}

function showStatsError() {
  successRateDisplay.textContent = "Error";
  uptimeDisplay.textContent = "Error";
}

// Fetch stats on page load and then every 30 seconds
fetchConnectionStats();
setInterval(fetchConnectionStats, 30000);
