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

    it("should configure working STUN servers without dead blackhole TURN URLs", () => {
      const { RTC_CONFIG, getEffectiveRtcConfig } = require("../../src/core/webrtc-manager");
      expect(RTC_CONFIG).toBeDefined();
      expect(RTC_CONFIG.iceServers).toBeDefined();
      expect(RTC_CONFIG.iceServers.length).toBeGreaterThan(0);

      const serverUrls = RTC_CONFIG.iceServers[0].urls as string[];
      expect(serverUrls.some((u: string) => u.includes("stun.l.google.com"))).toBe(true);
      expect(serverUrls.some((u: string) => u.includes("stun.cloudflare.com"))).toBe(true);
      expect(serverUrls.some((u: string) => u.includes("openrelay.metered.ca"))).toBe(false);

      const effective = getEffectiveRtcConfig();
      expect(effective.iceServers?.length).toBeGreaterThan(0);
    });

    it("should suppress spurious client offers and synthesize MediaStream when ontrack has empty streams", async () => {
      const { WebRTCManager } = require("../../src/core/webrtc-manager");

      const originalRTCPC = (globalThis as any).RTCPeerConnection;
      const originalMediaStream = (globalThis as any).MediaStream;
      const originalRTCSD = (globalThis as any).RTCSessionDescription;

      let capturedPc: any = null;
      class MockMediaStream {
        public tracks: any[] = [];
        addTrack(t: any) {
          this.tracks.push(t);
        }
        getTracks() {
          return this.tracks;
        }
      }
      class MockRTCPC {
        public signalingState = "stable";
        public connectionState = "new";
        public remoteDescription: any = null;
        public onicecandidate: any = null;
        public ontrack: any = null;
        public onconnectionstatechange: any = null;
        public onnegotiationneeded: any = null;
        public ondatachannel: any = null;
        constructor() {
          capturedPc = this;
        }
        addTransceiver() {
          // Simulate browser firing negotiationneeded when recvonly transceiver is added
          if (this.onnegotiationneeded) {
            void this.onnegotiationneeded();
          }
          return {};
        }
        createDataChannel() {
          return { readyState: "open", close() {}, send() {} };
        }
        getSenders() {
          return [];
        }
        getTransceivers() {
          return [];
        }
        async createOffer() {
          return { type: "offer", sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n" };
        }
        async createAnswer() {
          return { type: "answer", sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n" };
        }
        async setLocalDescription() {}
        async setRemoteDescription(desc: any) {
          this.remoteDescription = desc;
        }
        close() {}
      }

      (globalThis as any).MediaStream = MockMediaStream;
      (globalThis as any).RTCSessionDescription = function (init: any) {
        return init;
      };
      (globalThis as any).RTCPeerConnection = MockRTCPC;

      try {
        const signals: any[] = [];
        let receivedStream: any = null;
        const clientManager = new WebRTCManager({
          onSignal: (s: any) => signals.push(s),
          onRemoteStream: (stream: any) => {
            receivedStream = stream;
          },
        });

        await clientManager.initializeAsClient();
        // Force negotiationneeded to fire like Chrome does on client recvonly transceiver
        await capturedPc.onnegotiationneeded?.();
        expect(signals.filter((s) => s.kind === "offer").length).toBe(0);

        // Simulate Chrome 109 ontrack with empty event.streams
        const fakeTrack = { kind: "video", id: "v1", stop() {} };
        capturedPc.ontrack?.({ track: fakeTrack, streams: [] });
        expect(receivedStream).not.toBeNull();
        expect(receivedStream.getTracks()).toContain(fakeTrack);

        clientManager.close();
      } finally {
        (globalThis as any).RTCPeerConnection = originalRTCPC;
        (globalThis as any).MediaStream = originalMediaStream;
        (globalThis as any).RTCSessionDescription = originalRTCSD;
      }
    });
  });

  describe("4. AnyDesk-Style WSS Frame Relay Engine", () => {
    it("should strictly validate video-frame, video-frame-chunk, video-status, and control-relay packets", () => {
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

      const chunkMsg = parseSignalingMessage({
        type: "video-frame-chunk",
        targetId: "123456789",
        senderId: "987654321",
        frameId: "frame-1",
        chunkIndex: 0,
        totalChunks: 3,
        data: "data:image/webp;base64,AAAA",
        width: 960,
        height: 540,
        timestamp: Date.now(),
      });
      expect(chunkMsg?.type).toBe("video-frame-chunk");

      const statusMsg = parseSignalingMessage({
        type: "video-status",
        targetId: "123456789",
        senderId: "987654321",
        webrtcActive: true,
      });
      expect(statusMsg?.type).toBe("video-status");

      const controlRelayMsg = parseSignalingMessage({
        type: "control-relay",
        targetId: "123456789",
        senderId: "987654321",
        packet: {
          kind: "mouse-down",
          button: "left",
          x: 0.5,
          y: 0.5,
        },
      });
      expect(controlRelayMsg?.type).toBe("control-relay");
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

    it("should validate transfer-relay and stream-quality schemas cleanly", () => {
      const { parseSignalingMessage, parseControlPacket } = require("../../src/shared/protocol");
      const relayMsg = parseSignalingMessage({
        type: "transfer-relay",
        targetId: "123456789",
        senderId: "987654321",
        packet: {
          kind: "clipboard-sync",
          text: "Olá OmniDesk",
          timestamp: Date.now(),
        },
      });
      expect(relayMsg?.type).toBe("transfer-relay");

      const qualityPkt = parseControlPacket({ kind: "stream-quality", quality: "original" });
      expect(qualityPkt?.kind).toBe("stream-quality");
    });
  });
});
