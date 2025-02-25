let incomingFileInfo = null;
let incomingFileData = [];
let bytesReceived = 0;

const CHUNK_SIZE = 16 * 1024;

// called after creating or receiving a data channel.
function setupDataChannel(channel) {
  // needed for file chunks
  channel.binaryType = "arraybuffer";

  // triggered when a peer sends something over the data channel
  channel.onmessage = (event) => {
    // could be JSON metdata
    if (typeof event.data === "string") {
      handleControlMessage(event.data);
    } else {
      // file chunk
      handleFileChunk(event.data);
    }
  };
}

// reads file in slices and sends each chunk over the data channel
function sendFileInChunks(file) {
  let offset = 0; // number of bytes that have been sent
  const reader = new FileReader();

  // triggered after a slice is successfully read as an ArrayBuffer
  reader.onload = async (e) => {
    const chunk = e.target.result;

    // wait if there is too much data buffered
    while (dataChannel.bufferedAmount > 65535) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    dataChannel.send(chunk);
    offset += chunk.byteLength;

    document.getElementById("status").textContent = `Sending... ${Math.floor(
      (offset / file.size) * 100
    )}%`;

    // if there is more file to read
    if (offset < file.size) {
      readSlice(offset);
    } else {
      document.getElementById("status").textContent = "File sent!";
      dataChannel.send(JSON.stringify({ type: "done" }));
      addSentFile(file);
    }
  };

  reader.onerror = (err) => console.error("Error reading file:", err);

  // reads a portion of file starting at index 'o'
  function readSlice(o) {
    reader.readAsArrayBuffer(file.slice(o, o + CHUNK_SIZE));
  }

  readSlice(0);
}

// receives JSON messages
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

// each time we get a chunk, append it to incomingFileData
function handleFileChunk(arrayBuffer) {
  if (!incomingFileInfo) return;

  incomingFileData.push(arrayBuffer);
  bytesReceived += arrayBuffer.byteLength;

  document.getElementById("status").textContent = `Receiving ${
    incomingFileInfo.fileName
  }... ${Math.floor((bytesReceived / incomingFileInfo.fileSize) * 100)}%`;
}

// after all chunks have arrived
function finalizeReceivedFile() {
  const receivedBlob = new Blob(incomingFileData);
  const downloadURL = URL.createObjectURL(receivedBlob);
  const link = document.createElement("a");

  link.href = downloadURL;
  link.download = incomingFileInfo.fileName;
  link.textContent = incomingFileInfo.fileName;

  document.getElementById("receivedFiles").appendChild(link);
  document
    .getElementById("receivedFiles")
    .appendChild(document.createElement("br"));

  document.getElementById("status").textContent = "File received!";

  incomingFileInfo = null;
  incomingFileData = [];
  bytesReceived = 0;
}

// display link to the file just sent, in case user forgot what they sent
function addSentFile(file) {
  const fileURL = URL.createObjectURL(file);
  const link = document.createElement("a");

  link.href = fileURL;
  link.download = file.name;
  link.textContent = `${file.name} (local)`;

  document.getElementById("sentFiles").appendChild(link);
  document
    .getElementById("sentFiles")
    .appendChild(document.createElement("br"));
}
