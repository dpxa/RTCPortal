// HTML objects for file transfer
const fileInputFT = document.getElementById("fileInput");
const sendFileBtnFT = document.getElementById("sendFileBtn");

function ensureStatusElement() {
  let statusEl = document.getElementById("status");
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.id = "status";
    fileInputFT.parentNode.appendChild(statusEl);
  }
  return statusEl;
}

const statusDivFT = ensureStatusElement();
const sentFilesContainerFT = document.getElementById("sentFiles");
const receivedFilesContainerFT = document.getElementById("receivedFiles");
const clearHistoryContainerFT = document.querySelector(
  ".clear-history-container"
);

// HTML markup for progress container
const progressContainerHTML = `
  <div class="progress-container">
    <div class="progress-bar" style="width: 0%"></div>
    <span class="progress-percentage" style="display:none;">0%</span>
  </div>
`;

let progressContainerFT = null;
let transferProgressFT = null;
let transferPercentageFT = null;

let incomingFileInfo = null;
let incomingFileData = []; // Array to store chunks
let bytesReceived = 0;
const CHUNK_SIZE = 16 * 1024;

function ensureProgressContainer() {
  let container = document.querySelector(".progress-container");
  if (!container) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = progressContainerHTML;
    container = tempDiv.firstElementChild;
    // insert progress bar and percentage div after status div
    statusDivFT.parentNode.insertBefore(container, statusDivFT.nextSibling);
    progressContainerFT = container;
    transferProgressFT = container.querySelector(".progress-bar");
    transferPercentageFT = container.querySelector(".progress-percentage");
  } 

  container.style.display = "block";
  transferPercentageFT.style.display = "inline-block";
  return container;
}

function updateProgressBar(percent) {
  ensureProgressContainer();
  transferProgressFT.style.width = `${percent}%`;
  transferPercentageFT.textContent = `${percent}%`;
}

function resetProgressBar() {
  const container = document.querySelector(".progress-container");
  if (container) {
    container.remove();
  }
  statusDivFT.textContent = "";
}

sendFileBtnFT.addEventListener("click", () => {
  // if data channel is not avaliable
  if (!dataChannel || dataChannel.readyState !== "open") {
    alert("Data channel not open!");
    return;
  }

  // get the selected file and validate
  const file = fileInputFT.files[0];
  if (!file) {
    alert("No file selected!");
    return;
  }

  // send file metadata as a JSON string first
  dataChannel.send(
    JSON.stringify({
      type: "metadata",
      fileName: file.name,
      fileSize: file.size,
    })
  );

  sendFileInChunks(file);
});

function sendFileInChunks(file) {
  // disable send button to prevent multiple transfers
  sendFileBtnFT.disabled = true;
  statusDivFT.textContent = "File sending...";
  ensureProgressContainer();

  let offset = 0;
  const reader = new FileReader();

  // when chunk of file is read
  reader.onload = async (e) => {
    const chunk = e.target.result;
    // if the buffer is full, wait before continuing
    while (dataChannel.bufferedAmount > 65535) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // send data over data channel and update UI
    dataChannel.send(chunk);
    offset += chunk.byteLength;
    const percent = Math.floor((offset / file.size) * 100);
    updateProgressBar(percent);

    if (offset < file.size) { 
      readSlice(offset);
    } else { 
      statusDivFT.textContent = "File sent!"; // Update status message
      // send done message as a JSON string last 
      dataChannel.send(JSON.stringify({ type: "done" }));
      // add sent file to UI
      addSentFile(file);
      // pause progress bar and percentage at 100% so user can see completion
      setTimeout(() => {
        resetProgressBar();
        sendFileBtnFT.disabled = false;
      }, 500);
    }
  };

  reader.onerror = (err) => {
    // error - reset progress bar and re-enable send button
    console.error("Error reading file:", err);
    resetProgressBar();
    sendFileBtnFT.disabled = false;
  };

  // read a specific chunk of the file
  function readSlice(o) {
    reader.readAsArrayBuffer(file.slice(o, o + CHUNK_SIZE));
  }

  // initial call - start reading from beginning
  readSlice(0);
}

// Function to handle control messages (metadata and transfer completion)
function handleControlMessage(str) {
  try {
    // parse JSON message
    const message = JSON.parse(str);
    // if metadata, initialize file reception variables
    if (message.type === "metadata") {
      incomingFileInfo = {
        fileName: message.fileName,
        fileSize: message.fileSize,
      };
      incomingFileData = [];
      bytesReceived = 0;

      // update UI to show file reception status
      statusDivFT.textContent = "File receiving...";
      ensureProgressContainer();
    } else if (message.type === "done") {
      // if done, finalize file reception
      finalizeReceivedFile();
    }
  } catch (err) {
    // log non-JSON message
    console.log("Received text:", str);
  }
}

// Function to handle receiving file chunks
function handleFileChunk(arrayBuffer) {
  // ignore chunks if no file transfer is in progress
  if (!incomingFileInfo) return;

  // recieve data from data channel and update UI
  incomingFileData.push(arrayBuffer);
  bytesReceived += arrayBuffer.byteLength;
  const percent = Math.floor((bytesReceived / incomingFileInfo.fileSize) * 100);
  updateProgressBar(percent);
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  // calculate bytes with the appropriate size
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + " " + sizes[i];
}

function finalizeReceivedFile() {
  const receivedBlob = new Blob(incomingFileData);
  const downloadURL = URL.createObjectURL(receivedBlob);
  const link = document.createElement("a");

  link.href = downloadURL;
  link.download = incomingFileInfo.fileName;
  link.textContent = incomingFileInfo.fileName;

  // info for each link
  const info = document.createElement("span");
  const now = new Date();
  info.textContent = ` (size: ${formatBytes(
    incomingFileInfo.fileSize
  )}, received from: ${connectedPeerId}, received at: ${now.toLocaleTimeString()})`;

  // create container for link and info
  const container = document.createElement("div");
  container.appendChild(link);
  container.appendChild(info);
  receivedFilesContainerFT.appendChild(container);

  // ensure clear history button is present if needed
  updateClearHistoryVisibility();

  // pause progress bar and percentage at 100% so user can see completion
  statusDivFT.textContent = "File received!";
  setTimeout(() => {
    resetProgressBar();
  }, 500);

  // reset file reception variables
  incomingFileInfo = null;
  incomingFileData = [];
  bytesReceived = 0;
}

function addSentFile(file) {
  const fileURL = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = fileURL;
  link.download = file.name;
  link.textContent = file.name;

  // info for each link
  const info = document.createElement("span");
  const now = new Date();
  info.textContent = ` (size: ${formatBytes(
    file.size
  )}, sent to: ${connectedPeerId}, sent at: ${now.toLocaleTimeString()})`;

  // create container for link and info
  const container = document.createElement("div");
  container.appendChild(link);
  container.appendChild(info);
  sentFilesContainerFT.appendChild(container);

  updateClearHistoryVisibility();
}

// show/hide clear history button based on file history
function updateClearHistoryVisibility() {
  let clearHistoryBtn = document.getElementById("clearHistoryBtn");

  // if there is at least one file in history
  if (sentFilesContainerFT.childElementCount > 0 || receivedFilesContainerFT.childElementCount > 0) {
    // create clear history button if it doesn't exist
    if (!clearHistoryBtn) {
      clearHistoryBtn = document.createElement("button");
      clearHistoryBtn.id = "clearHistoryBtn";
      clearHistoryBtn.className = "clear-history-button";
      clearHistoryBtn.textContent = "Clear History";

      clearHistoryBtn.addEventListener("click", () => {
        sentFilesContainerFT.innerHTML = "";
        receivedFilesContainerFT.innerHTML = "";
        clearHistoryBtn.remove();
      });

      clearHistoryContainerFT.appendChild(clearHistoryBtn);
    }

    // make sure button is visible
    clearHistoryBtn.style.display = "inline-block";
  } else {
    // remove button if no files are left
    if (clearHistoryBtn) {
      clearHistoryBtn.remove();
    }
  }
}
