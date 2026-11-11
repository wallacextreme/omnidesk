import { describe, it, expect, beforeEach } from "bun:test";
import {
  generateSecureDeviceId,
  getOrCreateHostSecret,
  SignalingClient,
  CLOUD_BROKERS,
  type SignalingMode,
} from "../../src/core/signaling-client";
import { DEVICE_ID_REGEX } from "../../src/shared/protocol";

describe("Phase 4: Hybrid Cloud Signaling & Windows 7 Zero-Config", () => {
  describe("1. Device Identity & Anti-Hijacking Token Generation", () => {
    it("should generate a cryptographically secure 9-digit device ID matching protocol regex", () => {
      for (let i = 0; i < 20; i++) {
        const id = generateSecureDeviceId();
        expect(id).toMatch(DEVICE_ID_REGEX);
        expect(id.length).toBe(9);
        const numeric = Number(id);
        expect(numeric).toBeGreaterThanOrEqual(100_000_000);
        expect(numeric).toBeLessThanOrEqual(999_999_999);
      }
    });

    it("should generate and retrieve a 64-character hexadecimal host secret token", () => {
      const secret = getOrCreateHostSecret();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(secret.length).toBe(64);
    });

    it("should verify public WSS cloud brokers are defined with secure endpoints", () => {
      expect(CLOUD_BROKERS.length).toBeGreaterThanOrEqual(2);
      expect(CLOUD_BROKERS[0]).toStartWith("wss://");
      expect(CLOUD_BROKERS[1]).toStartWith("wss://");
    });
  });

  describe("2. Hybrid Signaling Client State & Mode Switching", () => {
    it("should initialize with specified mode and manage switching gracefully", () => {
      let currentMode: SignalingMode = "cloud";
      const client = new SignalingClient(
        {
          onStatusChange: (status) => {
            currentMode = status.mode;
          },
        },
        "cloud",
        "ws://192.168.1.138:4000"
      );

      expect(client.getMode()).toBe("cloud");
      expect(client.getLocalUrl()).toBe("ws://192.168.1.138:4000");

      client.switchMode("local", "ws://10.0.0.50:4000");
      expect(client.getMode()).toBe("local");
      expect(client.getLocalUrl()).toBe("ws://10.0.0.50:4000");

      client.disconnect();
    });
  });
});
