import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadPureModule } from "./helpers/load-client-module.mjs";

let encryption;
const originalCrypto = globalThis.crypto;

beforeEach(async () => {
  encryption = await loadPureModule("encryption");
});

afterEach(() => {
  try {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
  } catch {}
});

async function peerKeyPair() {
  return encryption.generateKeyPair();
}

test("generateKeyPair produces an ECDH P-256 keypair", async () => {
  const keyPair = await peerKeyPair();
  assert.ok(keyPair.privateKey, "private key missing");
  assert.ok(keyPair.publicKey, "public key missing");
  assert.equal(keyPair.privateKey.type, "private");
  assert.equal(keyPair.publicKey.type, "public");
  assert.equal(keyPair.publicKey.algorithm.name, "ECDH");
});

test("both peers derive the same session key via ECDH", async () => {
  const alice = await peerKeyPair();
  const bob = await peerKeyPair();

  const alicePub = await encryption.exportPublicKey(alice.publicKey);
  const bobPub = await encryption.exportPublicKey(bob.publicKey);

  const aliceKey = await encryption.deriveSessionKey(alice.privateKey, bobPub);
  const bobKey = await encryption.deriveSessionKey(bob.privateKey, alicePub);

  const aliceFingerprint = await encryption.fingerprintKey(aliceKey);
  const bobFingerprint = await encryption.fingerprintKey(bobKey);
  assert.equal(aliceFingerprint, bobFingerprint);
});

test("encryptChunk/decryptChunk round-trips binary data", async () => {
  const alice = await peerKeyPair();
  const bob = await peerKeyPair();
  const alicePub = await encryption.exportPublicKey(alice.publicKey);
  const bobPub = await encryption.exportPublicKey(bob.publicKey);
  const aliceKey = await encryption.deriveSessionKey(alice.privateKey, bobPub);
  const bobKey = await encryption.deriveSessionKey(bob.privateKey, alicePub);

  const plaintext = new TextEncoder().encode(
    "RTCPortal encrypted chunk test",
  ).buffer;
  const encrypted = await encryption.encryptChunk(aliceKey, plaintext);

  const cipherBytes = new Uint8Array(encrypted);
  const plainBytes = new Uint8Array(plaintext);
  assert.ok(cipherBytes.byteLength > plainBytes.byteLength);

  const decrypted = await encryption.decryptChunk(bobKey, encrypted);
  assert.deepEqual(new Uint8Array(decrypted), plainBytes);
});

test("encryptMessage/decryptMessage round-trips JSON", async () => {
  const alice = await peerKeyPair();
  const bob = await peerKeyPair();
  const alicePub = await encryption.exportPublicKey(alice.publicKey);
  const bobPub = await encryption.exportPublicKey(bob.publicKey);
  const aliceKey = await encryption.deriveSessionKey(alice.privateKey, bobPub);
  const bobKey = await encryption.deriveSessionKey(bob.privateKey, alicePub);

  const message = { type: "chat", text: "hello encrypted world" };
  const encrypted = await encryption.encryptMessage(aliceKey, message);
  const decrypted = await encryption.decryptMessage(bobKey, encrypted);
  assert.deepEqual(decrypted, message);
});

test("encryptFileChunk/decryptTaggedPayload round-trips binary data", async () => {
  const alice = await peerKeyPair();
  const bob = await peerKeyPair();
  const alicePub = await encryption.exportPublicKey(alice.publicKey);
  const bobPub = await encryption.exportPublicKey(bob.publicKey);
  const aliceKey = await encryption.deriveSessionKey(alice.privateKey, bobPub);
  const bobKey = await encryption.deriveSessionKey(bob.privateKey, alicePub);

  const plaintext = new TextEncoder().encode(
    "RTCPortal encrypted chunk test",
  ).buffer;
  const encrypted = await encryption.encryptFileChunk(aliceKey, plaintext);

  const cipherBytes = new Uint8Array(encrypted);
  const plainBytes = new Uint8Array(plaintext);

  const { tag, plaintext: decrypted } = await encryption.decryptTaggedPayload(
    bobKey,
    encrypted,
  );
  assert.equal(tag, encryption.ENCRYPTION_TAGS.BINARY);
  assert.deepEqual(new Uint8Array(decrypted), plainBytes);
});

test("encryptMessage payload carries the CONTROL tag", async () => {
  const alice = await peerKeyPair();
  const bob = await peerKeyPair();
  const alicePub = await encryption.exportPublicKey(alice.publicKey);
  const bobPub = await encryption.exportPublicKey(bob.publicKey);
  const aliceKey = await encryption.deriveSessionKey(alice.privateKey, bobPub);
  const bobKey = await encryption.deriveSessionKey(bob.privateKey, alicePub);

  const encrypted = await encryption.encryptMessage(aliceKey, {
    type: "ping",
  });
  const { tag } = await encryption.decryptTaggedPayload(bobKey, encrypted);
  assert.equal(tag, encryption.ENCRYPTION_TAGS.CONTROL);
});

test("tampering with ciphertext fails decryption", async () => {
  const alice = await peerKeyPair();
  const bob = await peerKeyPair();
  const alicePub = await encryption.exportPublicKey(alice.publicKey);
  const bobPub = await encryption.exportPublicKey(bob.publicKey);
  const aliceKey = await encryption.deriveSessionKey(alice.privateKey, bobPub);
  const bobKey = await encryption.deriveSessionKey(bob.privateKey, alicePub);

  const plaintext = new TextEncoder().encode("integrity check").buffer;
  const encrypted = await encryption.encryptFileChunk(aliceKey, plaintext);

  const tampered = new Uint8Array(encrypted);
  tampered[tampered.length - 1] ^= 0x01; // flip the last auth-tag byte

  await assert.rejects(() =>
    encryption.decryptTaggedPayload(bobKey, tampered.buffer),
  );
});

test("two different keypairs produce different session keys", async () => {
  const alice = await peerKeyPair();
  const bob = await peerKeyPair();
  const eve = await peerKeyPair();
  const alicePub = await encryption.exportPublicKey(alice.publicKey);
  const bobPub = await encryption.exportPublicKey(bob.publicKey);
  const evePub = await encryption.exportPublicKey(eve.publicKey);

  const bobKey = await encryption.deriveSessionKey(bob.privateKey, alicePub);
  const eveKey = await encryption.deriveSessionKey(eve.privateKey, alicePub);

  const bobFp = await encryption.fingerprintKey(bobKey);
  const eveFp = await encryption.fingerprintKey(eveKey);
  assert.notEqual(bobFp, eveFp);
});
