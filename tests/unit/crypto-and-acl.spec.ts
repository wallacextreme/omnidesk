import { describe, it, expect } from "bun:test";
import {
  generateNonce,
  generateSalt,
  computeAuthProof,
  verifyAuthProof,
  constantTimeCompare,
  sha256,
  isSubtleAvailable,
  jsSha256Raw,
  jsHmacSha256,
  jsPbkdf2Sha256,
  bufferToHex,
  hexToBuffer,
  PBKDF2_ITERATIONS,
} from "../../src/core/crypto";
import { ACLGuard } from "../../src/core/acl-guard";
import type { InputPacket, ControlChannelPacket, TransferChannelPacket } from "../../src/shared/protocol";

describe("Phase 2: Crypto & ACL Guard Quality Gate", () => {
  describe("1. Cloudflare Security Audit: Challenge-Response & Cryptographic Integrity", () => {
    it("should generate cryptographically secure random nonces and salts", () => {
      const nonce1 = generateNonce(32);
      const nonce2 = generateNonce(32);
      const salt1 = generateSalt(16);
      const salt2 = generateSalt(16);

      expect(nonce1).toHaveLength(64); // 32 bytes in hex = 64 characters
      expect(nonce2).toHaveLength(64);
      expect(salt1).toHaveLength(32); // 16 bytes in hex = 32 characters
      expect(salt2).toHaveLength(32);

      // Must be unique
      expect(nonce1).not.toBe(nonce2);
      expect(salt1).not.toBe(salt2);
    });

    it("should compute valid HMAC-SHA256 proof and verify it successfully", async () => {
      const password = "StrongMasterPassword#2026";
      const salt = generateSalt(16);
      const nonce = generateNonce(32);

      const proof = await computeAuthProof(password, salt, nonce);
      expect(proof).toHaveLength(64); // HMAC-SHA256 hex is 64 characters

      const isValid = await verifyAuthProof(password, salt, nonce, proof);
      expect(isValid).toBe(true);
    });

    it("should prevent Replay Attacks: proof generated for nonce A must fail for nonce B", async () => {
      const password = "SuperSecretPassword123!";
      const salt = generateSalt(16);
      const nonceOriginal = generateNonce(32);
      const nonceReplay = generateNonce(32);

      // Attacker intercepts proof from an earlier session with nonceOriginal
      const interceptedProof = await computeAuthProof(password, salt, nonceOriginal);

      // Attacker tries to replay interceptedProof for a new challenge with nonceReplay
      const isReplayValid = await verifyAuthProof(password, salt, nonceReplay, interceptedProof);
      expect(isReplayValid).toBe(false);
    });

    it("should reject incorrect passwords or tampered proofs", async () => {
      const salt = generateSalt(16);
      const nonce = generateNonce(32);

      const proof = await computeAuthProof("CorrectPassword", salt, nonce);

      // Wrong password
      const wrongPasswordValid = await verifyAuthProof("WrongPassword", salt, nonce, proof);
      expect(wrongPasswordValid).toBe(false);

      // Tampered proof
      const tamperedProof = proof.slice(0, -2) + "00";
      const tamperedValid = await verifyAuthProof("CorrectPassword", salt, nonce, tamperedProof);
      expect(tamperedValid).toBe(false);
    });

    it("should compute accurate SHA-256 digests for data chunks", async () => {
      const sample = "PulseDeskPro-64KB-Chunk-Data";
      const digest = await sha256(sample);
      expect(digest).toHaveLength(64);

      // Consistency check
      const digest2 = await sha256(sample);
      expect(digest).toBe(digest2);
    });

    it("should perform constant-time comparison reliably", () => {
      expect(constantTimeCompare("abc123xyz", "abc123xyz")).toBe(true);
      expect(constantTimeCompare("abc123xyz", "abc123xyw")).toBe(false);
      expect(constantTimeCompare("abc", "abcd")).toBe(false);
    });

    it("should verify isSubtleAvailable and guarantee deterministic pure JS fallback in insecure HTTP", async () => {
      expect(typeof isSubtleAvailable).toBe("boolean");

      const testData = new TextEncoder().encode("OmniDesk Insecure HTTP Context Fallback");
      const jsHash = bufferToHex(jsSha256Raw(testData));
      expect(jsHash).toHaveLength(64);

      if (isSubtleAvailable) {
        const webHashBuffer = await crypto.subtle.digest("SHA-256", testData);
        const webHash = bufferToHex(new Uint8Array(webHashBuffer));
        expect(jsHash).toBe(webHash);
      }

      // Test HMAC-SHA256 pure JS against WebCrypto
      const keyBytes = new TextEncoder().encode("session-secret-key-1234");
      const jsHmac = bufferToHex(jsHmacSha256(keyBytes, testData));
      expect(jsHmac).toHaveLength(64);

      if (isSubtleAvailable) {
        const cKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const wcHmac = bufferToHex(new Uint8Array(await crypto.subtle.sign("HMAC", cKey, testData)));
        expect(jsHmac).toBe(wcHmac);
      }

      // Test Full Auth Proof equivalence between pure JS and computeAuthProof
      const pwd = "TestMasterPassword#2026";
      const salt = generateSalt(16);
      const nonce = generateNonce(32);

      const publicProof = await computeAuthProof(pwd, salt, nonce);

      // Explicitly compute using pure JS engine
      const pwdBytes = new TextEncoder().encode(pwd);
      const saltBytes = hexToBuffer(salt);
      const nonceBytes = hexToBuffer(nonce);
      const derivedKey = jsPbkdf2Sha256(pwdBytes, saltBytes, PBKDF2_ITERATIONS);
      const pureJsProof = bufferToHex(jsHmacSha256(derivedKey, nonceBytes));

      expect(publicProof).toBe(pureJsProof);
      expect(await verifyAuthProof(pwd, salt, nonce, pureJsProof)).toBe(true);
    });
  });

  describe("2. Host ACL Guard: Zero-Trust Input & Permission Filtering", () => {
    it("should initialize with default allowed permissions", () => {
      const acl = new ACLGuard();
      const perms = acl.getPermissions();

      expect(perms.allowInput).toBe(true);
      expect(perms.allowClipboard).toBe(true);
      expect(perms.allowFileTransfer).toBe(true);
      expect(perms.allowAudio).toBe(true);
    });

    it("should strictly block input packets when allowInput is disabled", () => {
      const acl = new ACLGuard({ allowInput: true });

      const mouseMove: InputPacket = { kind: "mouse-move", x: 0.5, y: 0.5 };
      const mouseDown: InputPacket = { kind: "mouse-down", button: "left", x: 0.5, y: 0.5 };
      const keyDown: InputPacket = {
        kind: "key-down",
        key: "Enter",
        code: "Enter",
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
      };

      // Allowed initially
      expect(acl.canExecuteInput(mouseMove)).toBe(true);
      expect(acl.canExecuteInput(mouseDown)).toBe(true);
      expect(acl.canExecuteInput(keyDown)).toBe(true);

      // Host revokes input permission in real time
      acl.updatePermissions({ allowInput: false });
      expect(acl.getPermissions().allowInput).toBe(false);

      // Must now block all input packets
      expect(acl.canExecuteInput(mouseMove)).toBe(false);
      expect(acl.canExecuteInput(mouseDown)).toBe(false);
      expect(acl.canExecuteInput(keyDown)).toBe(false);
    });

    it("should block clipboard and file transfer channels when ACL permissions are disabled", () => {
      const acl = new ACLGuard();

      const clipboardPacket: TransferChannelPacket = {
        kind: "clipboard-sync",
        text: "Copied secret text",
        timestamp: Date.now(),
      };

      const fileChunkPacket: TransferChannelPacket = {
        kind: "file-chunk",
        transferId: "123e4567-e89b-12d3-a456-426614174000",
        chunkIndex: 0,
        totalChunks: 1,
        dataBase64: "SGVsbG8=",
      };

      expect(acl.canExecuteTransferPacket(clipboardPacket)).toBe(true);
      expect(acl.canExecuteTransferPacket(fileChunkPacket)).toBe(true);

      // Disable clipboard
      acl.updatePermissions({ allowClipboard: false });
      expect(acl.canExecuteTransferPacket(clipboardPacket)).toBe(false);
      expect(acl.canExecuteTransferPacket(fileChunkPacket)).toBe(true);

      // Disable file transfer
      acl.updatePermissions({ allowFileTransfer: false });
      expect(acl.canExecuteTransferPacket(fileChunkPacket)).toBe(false);
    });

    it("should notify listeners when permissions change", () => {
      const acl = new ACLGuard();
      let listenerCalls = 0;
      let lastPerms: any = null;

      const unsubscribe = acl.addChangeListener((perms) => {
        listenerCalls++;
        lastPerms = perms;
      });

      acl.updatePermissions({ allowInput: false });
      expect(listenerCalls).toBe(1);
      expect(lastPerms?.allowInput).toBe(false);

      unsubscribe();
      acl.updatePermissions({ allowAudio: false });
      expect(listenerCalls).toBe(1); // No new call after unsubscribe
    });
  });
});
