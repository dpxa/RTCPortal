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

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const STAGING_PARENT = path.join(PROJECT_ROOT, "coverage-bundles");

let tempDir;
if (process.env.RTCPORTAL_COVERAGE === "1") {
  fs.mkdirSync(STAGING_PARENT, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(STAGING_PARENT, "rtcportal-tests-"));
} else {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtcportal-tests-"));
}

process.on("exit", () => {
  if (process.env.RTCPORTAL_COVERAGE === "1") return;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(STAGING_PARENT, { recursive: true, force: true });
});

export async function loadPureModule(name) {
  const src = PURE_MODULES[name];
  if (!src) throw new Error(`Unknown pure module: ${name}`);
  const dest = path.join(tempDir, `${name}.mjs`);
  fs.copyFileSync(src, dest);
  return await import(pathToFileURL(dest).href);
}
