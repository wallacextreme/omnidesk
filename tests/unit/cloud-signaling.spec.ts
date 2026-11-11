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

  describe("3. WebRTC Manager Client Video Transceiver & Role Separation", () => {
    it("should instantiate WebRTCManager and configure signal callbacks", () => {
      const { WebRTCManager } = require("../../src/core/webrtc-manager");
      let signalSent = false;
      const manager = new WebRTCManager({
        onSignal: () => {
          signalSent = true;
        },
      });

      expect(manager).toBeDefined();
      expect(typeof manager.initializeAsHost).toBe("function");
      expect(typeof manager.initializeAsClient).toBe("function");
      expect(typeof manager.close).toBe("function");
      manager.close();
    });

    it("should configure OpenRelay TURN servers for symmetric NAT penetration", () => {
      const { RTC_CONFIG } = require("../../src/core/webrtc-manager");
      expect(RTC_CONFIG).toBeDefined();
      expect(RTC_CONFIG.iceServers).toBeDefined();
      expect(RTC_CONFIG.iceServers.length).toBeGreaterThan(0);

      const serverUrls = RTC_CONFIG.iceServers[0].urls;
      const turnUrls = serverUrls.filter((u: string) => u.startsWith("turn:"));
      expect(turnUrls.length).toBeGreaterThanOrEqual(3);
      expect(turnUrls.some((u: string) => u.includes(":80"))).toBe(true);
      expect(turnUrls.some((u: string) => u.includes(":443"))).toBe(true);
      expect(turnUrls.some((u: string) => u.includes("transport=tcp"))).toBe(true);
      expect(RTC_CONFIG.iceServers[0].username).toBe("openrelayproject");
      expect(RTC_CONFIG.iceServers[0].credential).toBe("openrelayproject");
    });
  });

  describe("4. AnyDesk-Style WSS Frame Relay Engine", () => {
    it("should strictly validate video-frame signaling packets", () => {
      const { VideoFrameMsgSchema, parseSignalingMessage } = require("../../src/shared/protocol");
      const validFrame = {
        type: "video-frame",
        targetId: "123456789",
        senderId: "987654321",
        frameDataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        width: 960,
        height: 540,
        timestamp: Date.now(),
      };

      const parsed = VideoFrameMsgSchema.safeParse(validFrame);
      expect(parsed.success).toBe(true);

      const signaled = parseSignalingMessage(validFrame);
      expect(signaled).not.toBeNull();
      expect(signaled?.type).toBe("video-frame");
    });

    it("should instantiate and terminate FrameRelayHost safely", () => {
      const { FrameRelayHost } = require("../../src/core/frame-relay");
      const fakeStream = {} as MediaStream;
      const relay = new FrameRelayHost(fakeStream, () => {});
      expect(relay).toBeDefined();
      expect(typeof relay.start).toBe("function");
      expect(typeof relay.stop).toBe("function");
      relay.stop();
    });
  });
});
