function ensureJsZipLoaded() {
  if (typeof self.JSZip !== "undefined") {
    return;
  }

  const scriptCandidates = [
    "../vendor/jszip.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
  ];

  let lastError = null;
  for (const src of scriptCandidates) {
    try {
      self.importScripts(src);
      if (typeof self.JSZip !== "undefined") {
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `JSZip failed to load in worker.${lastError ? ` ${String(lastError)}` : ""}`,
  );
}

function buildZip(files) {
  ensureJsZipLoaded();

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
