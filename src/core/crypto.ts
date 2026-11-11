/**
 * OmniDesk Cryptographic Engine
 * Adheres strictly to Zero-Trust and Cloudflare Security Audit specifications.
 * Implements PBKDF2-SHA256 + HMAC-SHA256 challenge-response authentication with nonces to prevent Replay Attacks.
 */

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
  crypto.getRandomValues(array);
  return array;
}

export function generateNonce(byteLength = 32): string {
  return bufferToHex(generateRandomBytes(byteLength));
}

export function generateSalt(byteLength = 16): string {
  return bufferToHex(generateRandomBytes(byteLength));
}

export async function sha256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  let buffer: BufferSource;
  if (typeof data === "string") {
    const encoded = new TextEncoder().encode(data);
    const ab = new ArrayBuffer(encoded.length);
    new Uint8Array(ab).set(encoded);
    buffer = ab;
  } else if (data instanceof Uint8Array) {
    const ab = new ArrayBuffer(data.length);
    new Uint8Array(ab).set(data);
    buffer = ab;
  } else {
    buffer = data;
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return bufferToHex(new Uint8Array(hashBuffer));
}

/**
 * Derives an HMAC-SHA256 CryptoKey from password and salt using PBKDF2 (100,000 iterations).
 */
async function deriveHmacKey(password: string, saltHex: string): Promise<CryptoKey> {
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
      iterations: 100_000,
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
 */
export async function computeAuthProof(
  password: string,
  saltHex: string,
  nonceHex: string
): Promise<string> {
  const key = await deriveHmacKey(password, saltHex);
  const nonceBytes = hexToBuffer(nonceHex);
  const signature = await crypto.subtle.sign("HMAC", key, nonceBytes.buffer);
  return bufferToHex(new Uint8Array(signature));
}

/**
 * Verifies the provided proof against the password and challenge parameters in constant time.
 */
export async function verifyAuthProof(
  password: string,
  saltHex: string,
  nonceHex: string,
  providedProofHex: string
): Promise<boolean> {
  try {
    const expectedProof = await computeAuthProof(password, saltHex, nonceHex);
    return constantTimeCompare(expectedProof, providedProofHex);
  } catch (err) {
    console.error("[Crypto] Verification failed:", err);
    return false;
  }
}
