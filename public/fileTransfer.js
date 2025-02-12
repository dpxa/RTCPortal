let incomingFileInfo = null;
let incomingFileData = [];
let bytesReceived = 0;

// WebRTC data channel for file transfer messages
function setupDataChannel(channel) {
  channel.binaryType = "arraybuffer";

  channel.onmessage = (event) => {
    if (typeof event.data === "string") {
      handleControlMessage(event.data);
    } else {
      handleFileChunk(event.data);
    }
  };
}

// Send file in chunks
function sendFileInChunks(file) {
  let offset = 0;
  const reader = new FileReader();

  reader.onload = async (e) => {
    const chunk = e.target.result;

    while (dataChannel.bufferedAmount > 65535) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    dataChannel.send(chunk);
    offset += chunk.byteLength;
    document.getElementById("status").textContent = `Sending... ${Math.floor(
      (offset / file.size) * 100
    )}%`;

    if (offset < file.size) {
      readSlice(offset);
    } else {
      document.getElementById("status").textContent = "File sent!";
      dataChannel.send(JSON.stringify({ type: "done" }));
      addSentFile(file);
    }
  };

  reader.onerror = (err) => console.error("Error reading file:", err);

  function readSlice(o) {
    reader.readAsArrayBuffer(file.slice(o, o + CHUNK_SIZE));
  }

  readSlice(0);
}

// Handle received control messages
function handleControlMessage(str) {
  try {
    const message = JSON.parse(str);

    if (message.type === "metadata") {
      incomingFileInfo = {
        fileName: message.fileName,
        fileSize: message.fileSize,
      };

      incomingFileData = [];
      bytesReceived = 0;
      document.getElementById(
        "status"
      ).textContent = `Receiving ${incomingFileInfo.fileName}... 0%`;
    } else if (message.type === "done") {
      finalizeReceivedFile();
    }
  } catch (err) {
    console.log("Received text:", str);
  }
}

// Handle received file chunk
function handleFileChunk(arrayBuffer) {
  if (!incomingFileInfo) return;

  incomingFileData.push(arrayBuffer);
  bytesReceived += arrayBuffer.byteLength;

  document.getElementById("status").textContent = `Receiving ${
    incomingFileInfo.fileName
  }... ${Math.floor((bytesReceived / incomingFileInfo.fileSize) * 100)}%`;
}

// Finalize received file
function finalizeReceivedFile() {
  const receivedBlob = new Blob(incomingFileData);
  const downloadURL = URL.createObjectURL(receivedBlob);
  const link = document.createElement("a");

  link.href = downloadURL;
  link.download = incomingFileInfo.fileName || "file";
  link.textContent = incomingFileInfo.fileName;

  document.getElementById("receivedFiles").appendChild(link);
  document.getElementById("receivedFiles").appendChild(document.createElement("br"));
  document.getElementById("status").textContent = "File received!";

  incomingFileInfo = null;
  incomingFileData = [];
  bytesReceived = 0;
}

// Add sent file link
function addSentFile(file) {
  const fileURL = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = fileURL;
  link.download = file.name;
  link.textContent = `${file.name} (local)`;

  document.getElementById("sentFiles").appendChild(link);
  document.getElementById("sentFiles").appendChild(document.createElement("br"));
}
