import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PURE_MODULES = {
  commonUtils: path.resolve(
    __dirname,
    "../../../public/js/utils/commonUtils.js",
  ),
  incrementalSha256: path.resolve(
    __dirname,
    "../../../public/js/utils/incrementalSha256.js",
  ),
  encryption: path.resolve(__dirname, "../../../public/js/utils/encryption.js"),
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtcportal-tests-"));

export async function loadPureModule(name) {
  const src = PURE_MODULES[name];
  if (!src) throw new Error(`Unknown pure module: ${name}`);
  const dest = path.join(tempDir, `${name}.mjs`);
  fs.copyFileSync(src, dest);
  return await import(pathToFileURL(dest).href);
}

export { test, beforeEach, afterEach, assert };
