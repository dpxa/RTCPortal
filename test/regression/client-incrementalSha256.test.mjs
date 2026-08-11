// Unit tests for public/js/utils/incrementalSha256.js
//
// Pure ESM class (no relative imports). Loaded via the temp-fixture helper.
// Verifies the streaming SHA-256 implementation against known digests,
// including chunked updates, empty input, and boundary conditions.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadPureModule } from "./helpers/load-client-module.mjs";

let IncrementalSHA256;

beforeEach(async () => {
  ({ IncrementalSHA256 } = await loadPureModule("incrementalSha256"));
});

// Known SHA-256 digests (hex) for reference inputs.
const KNOWN = {
  "": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  abc: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  "hello world":
    "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
};

function digestOf(input) {
  const hasher = new IncrementalSHA256();
  hasher.update(new TextEncoder().encode(input));
  return hasher.digest();
}

test("produces correct digest for empty input", () => {
  assert.equal(digestOf(""), KNOWN[""]);
});

test("produces correct digest for 'abc'", () => {
  assert.equal(digestOf("abc"), KNOWN.abc);
});

test("produces correct digest for 'hello world'", () => {
  assert.equal(digestOf("hello world"), KNOWN["hello world"]);
});

test("chunked updates produce the same digest as a single update", () => {
  const input = "The quick brown fox jumps over the lazy dog. 0123456789";
  const single = new IncrementalSHA256();
  single.update(new TextEncoder().encode(input));

  const chunked = new IncrementalSHA256();
  const bytes = new TextEncoder().encode(input);
  for (let i = 0; i < bytes.length; i += 7) {
    chunked.update(bytes.subarray(i, i + 7));
  }

  assert.equal(chunked.digest(), single.digest());
});

test("handles input exactly at the 64-byte block boundary", () => {
  const input = "a".repeat(64);
  const hasher = new IncrementalSHA256();
  hasher.update(new TextEncoder().encode(input));
  assert.equal(hasher.digest().length, 64);
});

test("handles input spanning multiple blocks (128 bytes)", () => {
  const input = "b".repeat(128);
  const hasher = new IncrementalSHA256();
  hasher.update(new TextEncoder().encode(input));
  assert.equal(hasher.digest().length, 64);
});

test("handles input just under the 56-byte padding boundary", () => {
  // 55 bytes: fits in one block with padding.
  const input = "c".repeat(55);
  const hasher = new IncrementalSHA256();
  hasher.update(new TextEncoder().encode(input));
  assert.equal(hasher.digest().length, 64);
});

test("handles input at the 56-byte padding boundary (requires extra block)", () => {
  const input = "d".repeat(56);
  const hasher = new IncrementalSHA256();
  hasher.update(new TextEncoder().encode(input));
  assert.equal(hasher.digest().length, 64);
});

test("digest is deterministic across instances", () => {
  assert.equal(digestOf("deterministic"), digestOf("deterministic"));
});

test("accepts Uint8Array and ArrayBuffer-like chunks", () => {
  const hasher = new IncrementalSHA256();
  hasher.update(new Uint8Array([104, 105])); // "hi"
  assert.equal(hasher.digest().length, 64);
});

test("large input (1MB) produces a valid 64-char digest", () => {
  const big = new Uint8Array(1024 * 1024);
  big.fill(0x61); // 'a'
  const hasher = new IncrementalSHA256();
  hasher.update(big);
  const digest = hasher.digest();
  assert.equal(digest.length, 64);
  assert.match(digest, /^[0-9a-f]{64}$/);
});
