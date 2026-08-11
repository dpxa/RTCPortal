// Test helper: loads a frontend ESM module (written as `.js` with `export`)
// into the Node ESM loader without needing "type": "module" in package.json.
//
// Works by copying the module source into a temp file with a `.mjs`
// extension, then importing that via file URL and cleaning up.
//
// IMPORTANT: this only works for modules with NO relative imports (pure
// modules) or modules whose relative imports are also resolvable through
// the copied fixture (not handled here).

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A registry of pure frontend modules -> their source path. Only modules
// with zero relative imports may be added here.
// Note: this file lives at test/regression/helpers/, so the project root is
// three levels up.
const PURE_MODULES = {
  commonUtils: path.resolve(
    __dirname,
    "../../../public/js/utils/commonUtils.js",
  ),
  incrementalSha256: path.resolve(
    __dirname,
    "../../../public/js/utils/incrementalSha256.js",
  ),
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtcportal-tests-"));

/**
 * Copies the named pure module into the temp dir as a .mjs file and imports
 * it, returning the module namespace.
 * @param {"commonUtils"|"incrementalSha256"} name
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadPureModule(name) {
  const src = PURE_MODULES[name];
  if (!src) throw new Error(`Unknown pure module: ${name}`);
  const dest = path.join(tempDir, `${name}.mjs`);
  fs.copyFileSync(src, dest);
  return await import(pathToFileURL(dest).href);
}

// Export some helpers for use in tests.
export { test, beforeEach, afterEach, assert };
