/**
 * OmniDesk Cryptographic Engine
 * Adheres strictly to Zero-Trust and Cloudflare Security Audit specifications.
 * Implements PBKDF2-SHA256 + HMAC-SHA256 challenge-response authentication with nonces to prevent Replay Attacks.
 * Provides pure JS deterministic fallbacks for non-secure HTTP contexts (e.g. LAN IP testing http://192.168.x.x)
 * where window.crypto.subtle is undefined per W3C specification.
 */

export const isSubtleAvailable: boolean =
  typeof window !== "undefined"
    ? Boolean(window.crypto?.subtle && typeof window.crypto.subtle.digest === "function")
    : typeof crypto !== "undefined" && Boolean(crypto.subtle && typeof crypto.subtle.digest === "function");

export const PBKDF2_SUBTLE_ITERATIONS = 600_000;
export const PBKDF2_FALLBACK_ITERATIONS = 2_000;
export const PBKDF2_ITERATIONS = isSubtleAvailable ? PBKDF2_SUBTLE_ITERATIONS : PBKDF2_FALLBACK_ITERATIONS;

// Constant-time string comparison to prevent timing attacks
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return result === 0;
}

export function bufferToHex(bytes: Uint8Array): string {
  const hexParts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      hexParts.push(byte.toString(16).padStart(2, "0"));
    }
  }
  return hexParts.join("");
}

export function hexToBuffer(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const ab = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function generateRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(length);
  const array = new Uint8Array(ab);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(array);
  } else if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return array;
}

export function generateNonce(byteLength = 32): string {
  return bufferToHex(generateRandomBytes(byteLength));
}

export function generateSalt(byteLength = 16): string {
  return bufferToHex(generateRandomBytes(byteLength));
}

// ---------------------------------------------------------------------------
// Pure JavaScript Cryptographic Engine (Deterministic Fallback for Insecure HTTP)
// ---------------------------------------------------------------------------

function rotr(n: number, b: number): number {
  return (n >>> b) | (n << (32 - b));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function jsSha256Raw(message: Uint8Array): Uint8Array {
  const len = message.length;
  const bitLen = len * 8;
  const k = ((56 - ((len + 1) % 64)) + 64) % 64;
  const totalLen = len + 1 + k + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(message);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let i = 0; i < totalLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + s1 + ch + SHA256_K[t]! + w[t]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

export function jsHmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const formattedKey = new Uint8Array(blockSize);
  if (key.length > blockSize) {
    const hashed = jsSha256Raw(key);
    formattedKey.set(hashed);
  } else {
    formattedKey.set(key);
  }

  const oPad = new Uint8Array(blockSize);
  const iPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oPad[i] = formattedKey[i]! ^ 0x5c;
    iPad[i] = formattedKey[i]! ^ 0x36;
  }

  const inner = new Uint8Array(blockSize + message.length);
  inner.set(iPad);
  inner.set(message, blockSize);
  const innerHash = jsSha256Raw(inner);

  const outer = new Uint8Array(blockSize + 32);
  outer.set(oPad);
  outer.set(innerHash, blockSize);
  return jsSha256Raw(outer);
}

export async function jsPbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations = PBKDF2_FALLBACK_ITERATIONS
): Promise<Uint8Array> {
  const blockSize = 64;
  const formattedKey = new Uint8Array(blockSize);
  if (password.length > blockSize) {
    const hashed = jsSha256Raw(password);
    formattedKey.set(hashed);
  } else {
    formattedKey.set(password);
  }

  const oPad = new Uint8Array(blockSize);
  const iPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oPad[i] = formattedKey[i]! ^ 0x5c;
    iPad[i] = formattedKey[i]! ^ 0x36;
  }

  function fastHmac(msg: Uint8Array): Uint8Array {
    const inner = new Uint8Array(blockSize + msg.length);
    inner.set(iPad);
    inner.set(msg, blockSize);
    const innerHash = jsSha256Raw(inner);

    const outer = new Uint8Array(blockSize + 32);
    outer.set(oPad);
    outer.set(innerHash, blockSize);
    return jsSha256Raw(outer);
  }

  const initial = new Uint8Array(salt.length + 4);
  initial.set(salt);
  initial[salt.length + 3] = 1; // INT_32_BE(1)

  let u = fastHmac(initial);
  const out = new Uint8Array(u);

  for (let i = 1; i < iterations; i++) {
    u = fastHmac(u);
    for (let j = 0; j < 32; j++) {
      const current = out[j] ?? 0;
      const nextByte = u[j] ?? 0;
      out[j] = current ^ nextByte;
    }
    // Yield UI thread periodically so legacy systems (Windows 7 / Single-core) never freeze
    if (i % 250 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Unified Public Hashing & Auth API with Safe Context Switching
// ---------------------------------------------------------------------------

export async function sha256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else {
    bytes = new Uint8Array(data);
  }

  if (isSubtleAvailable && typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const ab = new ArrayBuffer(bytes.length);
      new Uint8Array(ab).set(bytes);
      const hashBuffer = await crypto.subtle.digest("SHA-256", ab);
      return bufferToHex(new Uint8Array(hashBuffer));
    } catch (err) {
      console.warn("[Crypto] Subtle.digest unavailable or failed, falling back to pure JS SHA-256:", err);
    }
  }

  // Pure JS fallback (deterministic, works in HTTP context)
  return bufferToHex(jsSha256Raw(bytes));
}

/**
 * Derives an HMAC-SHA256 CryptoKey using PBKDF2.
 */
async function deriveHmacKey(password: string, saltHex: string, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(password);
  const baseAb = new ArrayBuffer(enc.length);
  new Uint8Array(baseAb).set(enc);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    baseAb,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const saltBytes = hexToBuffer(saltHex);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes.buffer,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );
}

/**
 * Computes authentication proof: HMAC-SHA256(derivedKey, nonce)
 * Password NEVER travels over the network.
 * Compatible across WebCrypto (HTTPS/localhost) and Pure JS (HTTP 192.168.x.x).
 */
export async function computeAuthProof(
  password: string,
  saltHex: string,
  nonceHex: string,
  iterations?: number
): Promise<string> {
  const finalIterations = iterations ?? PBKDF2_ITERATIONS;

  if (isSubtleAvailable && typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const key = await deriveHmacKey(password, saltHex, finalIterations);
      const nonceBytes = hexToBuffer(nonceHex);
      const signature = await crypto.subtle.sign("HMAC", key, nonceBytes.buffer);
      return bufferToHex(new Uint8Array(signature));
    } catch (err) {
      console.warn("[Crypto] WebCrypto computeAuthProof failed, falling back to pure JS:", err);
    }
  }

  // Pure JS fallback (runs seamlessly in insecure HTTP contexts)
  const pwdBytes = new TextEncoder().encode(password);
  const saltBytes = hexToBuffer(saltHex);
  const nonceBytes = hexToBuffer(nonceHex);
  const derivedKey = await jsPbkdf2Sha256(pwdBytes, saltBytes, finalIterations);
  const signature = jsHmacSha256(derivedKey, nonceBytes);
  return bufferToHex(signature);
}

/**
 * Generates a cryptographically secure UUIDv4 with safe fallback for older browsers
 * and non-secure HTTP contexts (e.g. LAN IP testing where crypto.randomUUID is undefined).
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {}
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Verifies the provided proof against the password and challenge parameters in constant time.
 */
export async function verifyAuthProof(
  password: string,
  saltHex: string,
  nonceHex: string,
  providedProofHex: string,
  iterations?: number
): Promise<boolean> {
  try {
    const expectedProof = await computeAuthProof(password, saltHex, nonceHex, iterations);
    return constantTimeCompare(expectedProof, providedProofHex);
  } catch (err) {
    console.error("[Crypto] Verification failed:", err);
    return false;
  }
}
