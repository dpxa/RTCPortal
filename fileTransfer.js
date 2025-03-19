// Grab elements for handling file transfers
const uploadField = document.getElementById("uploadField");
const fileTransferTrigger = document.getElementById("fileTransferTrigger");
const fileStatusMessage = document.getElementById("fileStatusMessage");
const outgoingSectionDiv = document.getElementById("outgoingSection");
const incomingSectionDiv = document.getElementById("incomingSection");
const transferHistoryDiv = document.getElementById("transferHistory");
const outgoingFilesContainer = document.getElementById("outgoingFiles");
const incomingFilesContainer = document.getElementById("incomingFiles");
const eraseHistoryContainer = document.querySelector(
  ".erase-history-container"
);

let fileMsgTimer = null;

function displayFileAlert(alertText) {
  clearTimeout(fileMsgTimer);
  fileStatusMessage.textContent = alertText;
  fileStatusMessage.style.display = "inline-block";
  fileStatusMessage.style.border = "1.5px solid red";
  fileStatusMessage.style.color = "red";
  fileStatusMessage.style.padding = "1px 2px";
  fileStatusMessage.style.fontSize = "0.7rem";
  fileMsgTimer = setTimeout(clearFileAlert, 2000);
}

function clearFileAlert() {
  clearTimeout(fileMsgTimer);
  fileStatusMessage.textContent = "";
  fileStatusMessage.style.display = "none";
  fileStatusMessage.style.border = "";
  fileStatusMessage.style.color = "";
  fileStatusMessage.style.padding = "";
  fileStatusMessage.style.fontSize = "";
}

let transferStatusDiv = null;
let progressContainer = null;
let progressBar = null;
let progressPercent = null;

// need a status element on the page
function ensureTransferStatus() {
  transferStatusDiv = document.getElementById("transferStatus");
  if (!transferStatusDiv) {
    transferStatusDiv = document.createElement("div");
    transferStatusDiv.id = "transferStatus";
    uploadField.parentNode.appendChild(transferStatusDiv);
  }
  return transferStatusDiv;
}

// HTML snippet for progress bar
const progressHTML = `
  <div class="progress-container">
    <div class="progress-bar" style="width: 0%"></div>
    <span class="progress-percentage" style="display:none;">0%</span>
  </div>
`;

// creates or reveals the progress bar container
function showProgressContainer() {
  progressContainer = document.querySelector(".progress-container");
  if (!progressContainer) {
    const temp = document.createElement("div");
    temp.innerHTML = progressHTML;
    progressContainer = temp.firstElementChild;
    ensureTransferStatus();
    transferStatusDiv.parentNode.insertBefore(
      progressContainer,
      transferStatusDiv.nextSibling
    );
    progressBar = progressContainer.querySelector(".progress-bar");
    progressPercent = progressContainer.querySelector(".progress-percentage");
  }
  progressContainer.style.display = "block";
  progressPercent.style.display = "inline-block";
  return progressContainer;
}

// updates the progress bar width and label
function updateProgressBarValue(value) {
  showProgressContainer();
  progressBar.style.width = `${value}%`;
  progressPercent.textContent = `${value}%`;
}

// removes the progress bar and status text
function resetTransferUI() {
  if (progressContainer) {
    progressContainer.remove();
  }
  if (transferStatusDiv) {
    transferStatusDiv.remove();
  }
}

// Manages incoming file details
let receivedFileDetails = null;
let collectedChunks = [];
let receivedBytes = 0;
const SLICE_SIZE = 16 * 1024;

// enable file send button if valid
uploadField.addEventListener("input", () => {
  fileTransferTrigger.disabled = uploadField.value.trim() === "";
});

// initiaites file send
fileTransferTrigger.addEventListener("click", () => {
  if (!dataChannel || dataChannel.readyState !== "open") {
    displayFileAlert("Data channel not open! Ending connection...");
    setTimeout(() => {
      resetCurrentConnection();
    }, 2000);
    return;
  }
  const selectedFile = uploadField.files[0];

  if (selectedFile.size === 0) {
    displayFileAlert("Cannot send. File is Empty.");
    return;
  }

  clearFileAlert();
  dataChannel.send(
    JSON.stringify({
      type: "metadata",
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
    })
  );
  sendFileSlices(selectedFile);
});

// reads and transmits the file in slices
function sendFileSlices(fileObj) {
  fileTransferTrigger.disabled = true;
  ensureTransferStatus();
  transferStatusDiv.textContent = "Sending file...";
  showProgressContainer();

  let offset = 0;
  const reader = new FileReader();

  reader.onload = async (evt) => {
    const chunk = evt.target.result;
    while (dataChannel.bufferedAmount > 65535) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    dataChannel.send(chunk);

    offset += chunk.byteLength;
    const pct = Math.floor((offset / fileObj.size) * 100);
    transferStatusDiv.textContent = "Sending file...";
    updateProgressBarValue(pct);

    if (offset < fileObj.size) {
      readChunk(offset);
    } else {
      transferStatusDiv.textContent = "File sent!";
      dataChannel.send(JSON.stringify({ type: "done" }));
      recordSentFile(fileObj);
      setTimeout(() => {
        resetTransferUI();
        fileTransferTrigger.disabled = false;
      }, 500);
    }
  };

  reader.onerror = (error) => {
    console.error("File read error:", error);
    resetTransferUI();
    fileTransferTrigger.disabled = false;
  };

  function readChunk(position) {
    reader.readAsArrayBuffer(fileObj.slice(position, position + SLICE_SIZE));
  }
  readChunk(0);
}

// handles control or metadata messages from the peer
function processControlInstruction(input) {
  try {
    const info = JSON.parse(input);
    if (info.type === "metadata") {
      receivedFileDetails = {
        fileName: info.fileName,
        fileSize: info.fileSize,
      };
      collectedChunks = [];
      receivedBytes = 0;
      ensureTransferStatus();
      transferStatusDiv.textContent = "Receiving file...";
      showProgressContainer();
    } else if (info.type === "done") {
      finalizeIncomingFile();
    }
  } catch (err) {
    console.log("Received text message:", input);
  }
}

// handles incoming file chunk data
function processIncomingChunk(arrayBuffer) {
  if (!receivedFileDetails) return;
  collectedChunks.push(arrayBuffer);
  receivedBytes += arrayBuffer.byteLength;
  const pct = Math.floor((receivedBytes / receivedFileDetails.fileSize) * 100);
  transferStatusDiv.textContent = "Receiving file...";
  updateProgressBarValue(pct);
}

// converts the array of chunks into a file object
// provides link
function finalizeIncomingFile() {
  const finalBlob = new Blob(collectedChunks);
  const downloadURL = URL.createObjectURL(finalBlob);
  const link = document.createElement("a");
  link.href = downloadURL;
  link.download = receivedFileDetails.fileName;
  link.textContent = receivedFileDetails.fileName;

  const metaSpan = document.createElement("span");
  const now = new Date();
  metaSpan.textContent = ` (size: ${displayFileSize(
    receivedFileDetails.fileSize
  )}, from: ${activePeerId}, at: ${now.toLocaleTimeString()})`;

  const wrapperDiv = document.createElement("div");
  wrapperDiv.appendChild(link);
  wrapperDiv.appendChild(metaSpan);

  if (incomingFilesContainer.firstChild) {
    incomingFilesContainer.insertBefore(
      wrapperDiv,
      incomingFilesContainer.firstChild
    );
  } else {
    incomingSectionDiv.style.display = "block";
    incomingFilesContainer.appendChild(wrapperDiv);
  }
  toggleClearHistoryOption();

  transferStatusDiv.textContent = "File received!";
  setTimeout(resetTransferUI, 500);

  receivedFileDetails = null;
  collectedChunks = [];
  receivedBytes = 0;
}

// convert bytes to a more readable format
function displayFileSize(numBytes) {
  if (numBytes === 0) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB", "TB"];
  const order = Math.floor(Math.log(numBytes) / Math.log(1024));
  return `${(numBytes / Math.pow(1024, order)).toFixed(2)} ${units[order]}`;
}

// records sent files in the UI
function recordSentFile(fileObj) {
  const fileURL = URL.createObjectURL(fileObj);
  const link = document.createElement("a");
  link.href = fileURL;
  link.download = fileObj.name;
  link.textContent = fileObj.name;

  const metaSpan = document.createElement("span");
  const now = new Date();
  metaSpan.textContent = `  (size: ${displayFileSize(
    fileObj.size
  )}, to: ${activePeerId}, at: ${now.toLocaleTimeString()})`;

  const wrapperDiv = document.createElement("div");
  wrapperDiv.appendChild(link);
  wrapperDiv.appendChild(metaSpan);

  if (outgoingFilesContainer.firstChild) {
    outgoingFilesContainer.insertBefore(
      wrapperDiv,
      outgoingFilesContainer.firstChild
    );
  } else {
    outgoingSectionDiv.style.display = "block";
    outgoingFilesContainer.appendChild(wrapperDiv);
  }
  toggleClearHistoryOption();
}

// makes clear history button visible when there is any history
function toggleClearHistoryOption() {
  let eraseHistoryBtn = document.getElementById("eraseHistoryBtn");
  if (!eraseHistoryBtn) {
    eraseHistoryBtn = document.createElement("button");
    eraseHistoryBtn.id = "eraseHistoryBtn";
    eraseHistoryBtn.className = "erase-history-trigger";
    eraseHistoryBtn.textContent = "Clear History";
    eraseHistoryBtn.addEventListener("click", () => {
      outgoingFilesContainer.innerHTML = "";
      incomingFilesContainer.innerHTML = "";
      transferHistoryDiv.style.display = "none";
      outgoingSectionDiv.style.display = "none";
      incomingSectionDiv.style.display = "none";
      eraseHistoryBtn.remove();
    });
    eraseHistoryContainer.appendChild(eraseHistoryBtn);
  }
  transferHistoryDiv.style.display = "block";
  eraseHistoryBtn.style.display = "inline-block";
}
