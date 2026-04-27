self.importScripts(
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
);

function buildZip(files) {
  if (typeof self.JSZip === "undefined") {
    throw new Error("JSZip failed to load in worker.");
  }

  const zip = new self.JSZip();
  const createdDirs = new Set();

  for (const file of files) {
    const fileName = String(file?.name || "");
    if (!fileName) {
      continue;
    }

    const isDirectoryMarker = Boolean(file?.isDirectoryMarker);
    const fileDate = file?.lastModified
      ? new Date(file.lastModified)
      : new Date();
    const pathParts = fileName.split("/");
    let currentPath = "";

    const dirsToCreate =
      isDirectoryMarker || fileName.endsWith("/")
        ? pathParts
        : pathParts.slice(0, -1);

    for (const part of dirsToCreate) {
      if (!part) continue;
      currentPath += part + "/";
      if (!createdDirs.has(currentPath)) {
        zip.file(currentPath, null, { dir: true, date: fileDate });
        createdDirs.add(currentPath);
      }
    }

    if (!isDirectoryMarker && !fileName.endsWith("/")) {
      zip.file(fileName, file.blob, { date: fileDate });
    }
  }

  return zip.generateAsync({
    type: "blob",
    compression: "STORE",
  });
}

self.addEventListener("message", async (incomingEvent) => {
  try {
    const files = incomingEvent?.data?.files;
    if (!Array.isArray(files)) {
      throw new Error("Invalid ZIP worker payload.");
    }

    const blob = await buildZip(files);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({
      error: error?.message || "ZIP generation failed in worker.",
    });
  }
});
