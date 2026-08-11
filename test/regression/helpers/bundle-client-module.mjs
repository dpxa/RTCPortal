// Bundling loader for testing frontend ES modules that have relative
// imports. Copies the module and its transitive frontend deps into a temp
// tree, rewriting each `.js` file to `.mjs` and updating relative import
// specifiers so Node's ESM loader accepts everything.
//
// Importantly: JSON/other assets and non-frontend imports (e.g. socket.io's
// global `io`) are NOT rewritten — those must be stubbed as globals before
// import.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "../../..");
export const PUBLIC_JS = path.join(PROJECT_ROOT, "public/js");

let bundleCount = 0;

// A per-bundle unique temp directory.
export function createBundleDir() {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), `rtcportal-bundle-${bundleCount++}-`),
  );
}

const REL_IMPORT_RE = /(from\s+|import\s*)(["'])(\.[^"']+\.js)(["'])/g;

/**
 * Copies a frontend module (by absolute path) into `bundleDir`, rewriting
 * its `.js` relative imports to `.mjs`, and recursing into those deps.
 * Returns the importable `.mjs` URL.
 */
export async function bundleModule(srcPath, bundleDir) {
  const entries = new Map(); // srcPath -> destMjsPath
  const queue = [srcPath];

  while (queue.length) {
    const current = path.resolve(queue.pop());
    if (entries.has(current)) continue;

    const rel = path.relative(PUBLIC_JS, current);
    if (rel.startsWith("..")) {
      // Not under public/js — cannot bundle; caller must stub it.
      throw new Error(`Non-frontend dependency cannot be bundled: ${current}`);
    }
    const dest = path.join(bundleDir, rel.replace(/\.js$/, ".mjs"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let source = fs.readFileSync(current, "utf8");

    // Rewrite relative .js imports to .mjs.
    source = source.replace(REL_IMPORT_RE, (_m, prefix, q1, spec, q2) => {
      const resolved = path.resolve(path.dirname(current), spec);
      queue.push(resolved + (resolved.endsWith(".js") ? "" : ".js"));
      return `${prefix}${q1}${spec.replace(/\.js$/, ".mjs")}${q2}`;
    });

    fs.writeFileSync(dest, source, "utf8");
    entries.set(current, dest);
  }

  const topDest = entries.get(path.resolve(srcPath));
  return import(pathToFileURL(topDest).href);
}
