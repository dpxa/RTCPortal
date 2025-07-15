const uploadField = document.getElementById("upload-field");
const fileTransferBtn = document.getElementById("file-transfer-btn");
const fileStatusMessage = document.getElementById("file-status-message");
const outgoingSectionDiv = document.getElementById("outgoing-section");
const incomingSectionDiv = document.getElementById("incoming-section");
const transferHistoryDiv = document.getElementById("transfer-history");
const outgoingFilesContainer = document.getElementById("outgoing-files");
const incomingFilesContainer = document.getElementById("incoming-files");
const eraseHistoryContainer = document.querySelector(
  ".erase-history-container"
);

let fileMsgTimer = null;

let transferStatusDivSent = null;
let progressContainerSent = null;
let progressBarSent = null;
let progressPercentSent = null;

let transferStatusDivReceived = null;
let progressContainerReceived = null;
let progressBarReceived = null;
let progressPercentReceived = null;

// template for sending UI
const sentTemplateHTML = `
  <div id="sent-container">
    <div id="transfer-status-sent"></div>
    <div class="progress-container" id="sent-progress-container">
      <div class="progress-bar" style="width: 0%; background: #27ae60;"></div>
      <span class="progress-percentage" style="display:none;">0%</span>
    </div>
  </div>
`;

// template for receiving UI
const receivedTemplateHTML = `
  <div id="received-container">
    <div id="transfer-status-received"></div>
    <div class="progress-container" id="received-progress-container">
      <div class="progress-bar" style="width: 0%; background: #4a90e2;"></div>
      <span class="progress-percentage" style="display:none;">0%</span>
    </div>
  </div>
`;

const fileTransferUI = {
  showAlert(message) {
    clearTimeout(fileMsgTimer);
    uploadField.value = "";
    fileTransferBtn.disabled = true;
    fileStatusMessage.textContent = message;
    fileStatusMessage.style.display = "inline-block";
    fileStatusMessage.style.border = "1.5px solid red";
    fileStatusMessage.style.color = "red";
    fileStatusMessage.style.padding = "1px 2px";
    fileMsgTimer = setTimeout(() => this.clearAlert(), 4000);
  },

  clearAlert() {
    clearTimeout(fileMsgTimer);
    fileStatusMessage.textContent = "";
    fileStatusMessage.style.display = "none";
    fileStatusMessage.style.border = "";
    fileStatusMessage.style.color = "";
    fileStatusMessage.style.padding = "";
  },

  ensureSentContainer() {
    let container = document.getElementById("sent-container");
    if (!container) {
      const temp = document.createElement("div");
      temp.innerHTML = sentTemplateHTML;
      container = temp.firstElementChild;
      uploadField.parentNode.appendChild(container);
    }
    transferStatusDivSent = container.querySelector("#transfer-status-sent");
    progressContainerSent = container.querySelector("#sent-progress-container");
    progressBarSent = progressContainerSent.querySelector(".progress-bar");
    progressPercentSent = progressContainerSent.querySelector(
      ".progress-percentage"
    );

    progressContainerSent.style.display = "block";
    progressPercentSent.style.display = "inline-block";
  },

  updateSentProgressBarValue(value) {
    progressBarSent.style.width = `${value}%`;
    progressPercentSent.textContent = `${value}%`;
  },

  resetSentTransferUI() {
    const container = document.getElementById("sent-container");
    if (container) {
      container.remove();
    }

    transferStatusDivSent = null;
    progressContainerSent = null;
    progressBarSent = null;
    progressPercentSent = null;
  },

  ensureReceivedContainer() {
    let container = document.getElementById("received-container");
    if (!container) {
      const temp = document.createElement("div");
      temp.innerHTML = receivedTemplateHTML;
      container = temp.firstElementChild;
      uploadField.parentNode.appendChild(container);
    }
    transferStatusDivReceived = container.querySelector(
      "#transfer-status-received"
    );
    progressContainerReceived = container.querySelector(
      "#received-progress-container"
    );
    progressBarReceived =
      progressContainerReceived.querySelector(".progress-bar");
    progressPercentReceived = progressContainerReceived.querySelector(
      ".progress-percentage"
    );

    progressContainerReceived.style.display = "block";
    progressPercentReceived.style.display = "inline-block";
  },

  updateReceivedProgressBarValue(value) {
    progressBarReceived.style.width = `${value}%`;
    progressPercentReceived.textContent = `${value}%`;
  },

  resetReceivedTransferUI() {
    const container = document.getElementById("received-container");
    if (container) {
      container.remove();
    }
    transferStatusDivReceived = null;
    progressContainerReceived = null;
    progressBarReceived = null;
    progressPercentReceived = null;
  },
};

let receivedFileDetails = null;
let collectedChunks = [];
let receivedBytes = 0;
const SLICE_SIZE = 16384;

uploadField.addEventListener("input", () => {
  fileTransferBtn.disabled = uploadField.value.trim() === "";
});

fileTransferBtn.addEventListener("click", () => {
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
  fileTransferBtn.disabled = true;
  fileTransferUI.ensureSentContainer();
  transferStatusDivSent.textContent = "Sending file...";

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
    transferStatusDivSent.textContent = "Sending file...";
    fileTransferUI.updateSentProgressBarValue(pct);

    if (offset < fileObj.size) {
      readChunk(offset);
    } else {
      transferStatusDivSent.textContent = "File sent!";
      // send done when file finished sending so receiver knows when to stop
      dataChannel.send(JSON.stringify({ type: "done" }));
      recordSentFile(fileObj);
      // leave progress bar at 100% for some time
      setTimeout(() => {
        fileTransferUI.resetSentTransferUI();
        fileTransferBtn.disabled = false;
      }, 500);
    }
  };

  reader.onerror = (error) => {
    console.error("File read error:", error);
    fileTransferUI.resetSentTransferUI();
    fileTransferBtn.disabled = false;
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
      fileTransferUI.ensureReceivedContainer();
      transferStatusDivReceived.textContent = "Receiving file...";
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
  transferStatusDivReceived.textContent = "Receiving file...";
  fileTransferUI.updateReceivedProgressBarValue(pct);
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

  transferStatusDivReceived.textContent = "File received!";
  // leave progress bar at 100% for some time
  setTimeout(() => fileTransferUI.resetReceivedTransferUI(), 500);

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
  let eraseHistoryBtn = document.getElementById("erase-history-btn");
  if (!eraseHistoryBtn) {
    eraseHistoryBtn = document.createElement("button");
    eraseHistoryBtn.id = "erase-history-btn";
    eraseHistoryBtn.className = "erase-history-btn";
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
