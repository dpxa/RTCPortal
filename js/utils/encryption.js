const KEY_FORMAT = "raw";

const TAG_CONTROL = 0x01;
const TAG_BINARY = 0x02;

export const ENCRYPTION_TAGS = {
  CONTROL: TAG_CONTROL,
  BINARY: TAG_BINARY,
};

export async function deriveSessionKey(privateKey, remotePublicRaw) {
  const remotePublicKey = await crypto.subtle.importKey(
    "raw",
    remotePublicRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: remotePublicKey },
    privateKey,
    256,
  );

  return crypto.subtle.importKey(KEY_FORMAT, sharedBits, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

export async function exportPublicKey(publicKey) {
  return crypto.subtle.exportKey("raw", publicKey);
}

export async function encryptChunk(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  const out = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), iv.byteLength);
  return out.buffer;
}

export async function encryptFileChunk(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  const out = new Uint8Array(iv.byteLength + 1 + ciphertext.byteLength);
  out.set(iv, 0);
  out[iv.byteLength] = TAG_BINARY;
  out.set(new Uint8Array(ciphertext), iv.byteLength + 1);
  return out.buffer;
}

export async function decryptChunk(key, payload) {
  const bytes = new Uint8Array(payload);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}

export async function decryptTaggedPayload(key, payload) {
  const bytes = new Uint8Array(payload);
  const iv = bytes.slice(0, 12);
  const tag = bytes[12];
  const ciphertext = bytes.slice(13);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return { tag, plaintext };
}

export async function encryptMessage(key, message) {
  const plaintext = new TextEncoder().encode(JSON.stringify(message));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );

  const out = new Uint8Array(iv.byteLength + 1 + ciphertext.byteLength);
  out.set(iv, 0);
  out[iv.byteLength] = TAG_CONTROL;
  out.set(new Uint8Array(ciphertext), iv.byteLength + 1);
  return out.buffer;
}

export async function decryptMessage(key, payload) {
  try {
    const { plaintext } = await decryptTaggedPayload(key, payload);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    console.warn("Failed to decrypt control message:", error);
    return null;
  }
}

export async function fingerprintKey(key) {
  const raw = await crypto.subtle.exportKey(KEY_FORMAT, key);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
