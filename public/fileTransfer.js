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
let transferStatusDiv = null;
let progressContainer = null;
let progressBar = null;
let progressPercent = null;

const fileTransferUI = {
  showAlert(message) {
    clearTimeout(fileMsgTimer);
    uploadField.value = "";
    fileTransferTrigger.disabled = true;
    fileStatusMessage.textContent = message;
    fileStatusMessage.style.display = "inline-block";
    fileStatusMessage.style.border = "1.5px solid red";
    fileStatusMessage.style.color = "red";
    fileStatusMessage.style.padding = "1px 2px";
    fileStatusMessage.style.fontSize = "0.7rem";
    fileMsgTimer = setTimeout(() => this.clearAlert(), 4000);
  },

  clearAlert() {
    clearTimeout(fileMsgTimer);
    fileStatusMessage.textContent = "";
    fileStatusMessage.style.display = "none";
    fileStatusMessage.style.border = "";
    fileStatusMessage.style.color = "";
    fileStatusMessage.style.padding = "";
    fileStatusMessage.style.fontSize = "";
  },

  // make sure a file status element exists
  ensureStatusElement() {
    transferStatusDiv = document.getElementById("transferStatus");
    if (!transferStatusDiv) {
      transferStatusDiv = document.createElement("div");
      transferStatusDiv.id = "transferStatus";
      uploadField.parentNode.appendChild(transferStatusDiv);
    }
  },

  // HTML template for progress bar
  progressHTML: `
    <div class="progress-container">
      <div class="progress-bar" style="width: 0%"></div>
      <span class="progress-percentage" style="display:none;">0%</span>
    </div>
  `,

  // dynamically create progress bar
  showProgressContainer() {
    progressContainer = document.querySelector(".progress-container");
    if (!progressContainer) {
      const temp = document.createElement("div");
      temp.innerHTML = this.progressHTML;
      progressContainer = temp.firstElementChild;
      transferStatusDiv.parentNode.insertBefore(
        progressContainer,
        transferStatusDiv.nextSibling
      );
      progressBar = progressContainer.querySelector(".progress-bar");
      progressPercent = progressContainer.querySelector(".progress-percentage");
    }
    progressContainer.style.display = "block";
    progressPercent.style.display = "inline-block";
  },

  updateProgressBarValue(value) {
    progressBar.style.width = `${value}%`;
    progressPercent.textContent = `${value}%`;
  },

  resetTransferUI() {
    if (progressContainer) {
      progressContainer.remove();
      progressContainer = null;
      progressBar = null;
      progressPercent = null;
    }
    if (transferStatusDiv) {
      transferStatusDiv.remove();
      transferStatusDiv = null;
    }
  },
};

let receivedFileDetails = null;
let collectedChunks = [];
let receivedBytes = 0;
const SLICE_SIZE = 16384;

uploadField.addEventListener("input", () => {
  fileTransferTrigger.disabled = uploadField.value.trim() === "";
});

fileTransferTrigger.addEventListener("click", () => {
  // in case internet drops for either partner
  if (!dataChannel || dataChannel.readyState !== "open") {
    fileTransferUI.showAlert("Data channel not open! Ending connection...");
    setTimeout(() => {
      resetCurrentConnection();
    }, 4000);
    return;
  }

  const selectedFile = uploadField.files[0];
  if (selectedFile.size === 0) {
    fileTransferUI.showAlert("Cannot send. File is Empty.");
    return;
  }
  fileTransferUI.clearAlert();

  // send file name and size first so receiver knows when to start
  dataChannel.send(
    JSON.stringify({
      type: "metadata",
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
    })
  );
  sendFileSlices(selectedFile);
});

// send the actual file
function sendFileSlices(fileObj) {
  // make sure dynamically created status elements are present
  fileTransferTrigger.disabled = true;
  fileTransferUI.ensureStatusElement();
  transferStatusDiv.textContent = "Sending file...";
  fileTransferUI.showProgressContainer();

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
    fileTransferUI.updateProgressBarValue(pct);

    if (offset < fileObj.size) {
      readChunk(offset);
    } else {
      transferStatusDiv.textContent = "File sent!";
      // send done when file finished sending so receiver knows when to stop
      dataChannel.send(JSON.stringify({ type: "done" }));
      recordSentFile(fileObj);
      // leave progress bar at 100% for some time
      setTimeout(() => {
        fileTransferUI.resetTransferUI();
        fileTransferTrigger.disabled = false;
      }, 500);
    }
  };

  reader.onerror = (error) => {
    console.error("File read error:", error);
    fileTransferUI.resetTransferUI();
    fileTransferTrigger.disabled = false;
  };

  function readChunk(position) {
    reader.readAsArrayBuffer(fileObj.slice(position, position + SLICE_SIZE));
  }
  readChunk(0);
}

function processControlInstruction(input) {
  try {
    const info = JSON.parse(input);
    // start receiving file
    if (info.type === "metadata") {
      receivedFileDetails = {
        fileName: info.fileName,
        fileSize: info.fileSize,
      };
      collectedChunks = [];
      receivedBytes = 0;

      // make sure dynamically created status elements are present
      fileTransferUI.ensureStatusElement();
      transferStatusDiv.textContent = "Receiving file...";
      fileTransferUI.showProgressContainer();
    // end receiving file
    } else if (info.type === "done") {
      finalizeIncomingFile();
    }
  } catch (err) {
    console.log("Received text message:", input);
  }
}

function processIncomingChunk(arrayBuffer) {
  if (!receivedFileDetails) return;
  collectedChunks.push(arrayBuffer);
  receivedBytes += arrayBuffer.byteLength;
  const pct = Math.floor((receivedBytes / receivedFileDetails.fileSize) * 100);
  transferStatusDiv.textContent = "Receiving file...";
  fileTransferUI.updateProgressBarValue(pct);
}

// create and show link to download on receiver's side
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
  // leave progress bar at 100% for some time
  setTimeout(() => fileTransferUI.resetTransferUI(), 500);

  receivedFileDetails = null;
  collectedChunks = [];
  receivedBytes = 0;
}

function displayFileSize(numBytes) {
  if (numBytes === 0) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB", "TB"];
  const order = Math.floor(Math.log(numBytes) / Math.log(1024));
  return `${(numBytes / Math.pow(1024, order)).toFixed(2)} ${units[order]}`;
}

// create and show link to download on sender's side
// in case they forgot what they sent
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

// history button should be shown whenever there is anything in the history
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
