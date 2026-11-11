import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SignalingServer, RateLimiter } from "../../server/signaling";
import {
  SignalingMessageSchema,
  InputPacketSchema,
  FileChunkPacketSchema,
  ACLPermissionsSchema,
  formatDeviceId,
  normalizeDeviceId,
  isValidDeviceId,
  type SignalingMessage,
} from "../../src/shared/protocol";

const TEST_PORT = 4199;

describe("Phase 1: Protocol & Signaling Server Quality Gate", () => {
  let server: SignalingServer;

  beforeAll(() => {
    server = new SignalingServer(TEST_PORT);
    server.start();
  });

  afterAll(() => {
    server.stop();
  });

  describe("1. Protocol Schemas & Zod Strict Validation", () => {
    it("should validate and format 9-digit device IDs correctly", () => {
      expect(isValidDeviceId("123456789")).toBe(true);
      expect(isValidDeviceId("123 456 789")).toBe(true);
      expect(isValidDeviceId("12345")).toBe(false);
      expect(isValidDeviceId("12345678a")).toBe(false);

      expect(normalizeDeviceId("123 456 789")).toBe("123456789");
      expect(formatDeviceId("123456789")).toBe("123 456 789");
    });

    it("should strictly validate valid signaling messages", () => {
      const registerMsg = {
        type: "register-host",
        deviceName: "Host Machine 1",
        unattendedEnabled: true,
      };
      const parsedRegister = SignalingMessageSchema.safeParse(registerMsg);
      expect(parsedRegister.success).toBe(true);

      const sessionReq = {
        type: "session-request",
        targetId: "123456789",
        clientName: "Laptop",
        clientDeviceId: "987654321",
        hasUnattendedPassword: true,
      };
      const parsedSession = SignalingMessageSchema.safeParse(sessionReq);
      expect(parsedSession.success).toBe(true);
    });

    it("should reject invalid payloads with Zod (Quality Gate Requirement)", () => {
      // Missing required field 'deviceName'
      const invalidRegister = {
        type: "register-host",
      };
      expect(SignalingMessageSchema.safeParse(invalidRegister).success).toBe(false);

      // Malformed device ID
      const invalidTarget = {
        type: "session-request",
        targetId: "not-a-number",
        clientName: "Test",
        clientDeviceId: "123456789",
        hasUnattendedPassword: false,
      };
      expect(SignalingMessageSchema.safeParse(invalidTarget).success).toBe(false);

      // Invalid normalized coordinates in InputPacket (> 1.0)
      const invalidInput = {
        kind: "mouse-move",
        x: 1.5, // max is 1
        y: 0.5,
      };
      expect(InputPacketSchema.safeParse(invalidInput).success).toBe(false);

      // Invalid negative chunk index in FileChunk
      const invalidChunk = {
        kind: "file-chunk",
        transferId: "123e4567-e89b-12d3-a456-426614174000",
        chunkIndex: -1,
        totalChunks: 10,
        dataBase64: "SGVsbG8=",
      };
      expect(FileChunkPacketSchema.safeParse(invalidChunk).success).toBe(false);
    });
  });

  describe("2. Rate Limiting Unit Tests", () => {
    it("should enforce sliding window rate limiting", () => {
      const limiter = new RateLimiter(5, 5000);
      const testIp = "192.168.1.100";

      for (let i = 0; i < 5; i++) {
        expect(limiter.isRateLimited(testIp)).toBe(false);
      }
      // 6th request exceeds the max limit of 5
      expect(limiter.isRateLimited(testIp)).toBe(true);
    });
  });

  describe("3. WebSocket Signaling Server Integration", () => {
    function connectClient(): Promise<WebSocket> {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
        ws.onopen = () => resolve(ws);
        ws.onerror = (err) => reject(err);
      });
    }

    function waitForMessage(ws: WebSocket): Promise<any> {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          ws.removeEventListener("message", handler);
          resolve(JSON.parse(event.data.toString()));
        };
        ws.addEventListener("message", handler);
      });
    }

    it("should register two distinct clients and assign unique 9-digit IDs", async () => {
      const wsHost = await connectClient();
      const wsClient = await connectClient();

      // Register Host A
      wsHost.send(
        JSON.stringify({
          type: "register-host",
          deviceName: "Host Node Alpha",
          unattendedEnabled: true,
        })
      );
      const hostRegistered = await waitForMessage(wsHost);
      expect(hostRegistered.type).toBe("registered");
      expect(hostRegistered.success).toBe(true);
      expect(isValidDeviceId(hostRegistered.deviceId)).toBe(true);

      // Register Client B
      wsClient.send(
        JSON.stringify({
          type: "register-host",
          deviceName: "Client Node Beta",
          unattendedEnabled: false,
        })
      );
      const clientRegistered = await waitForMessage(wsClient);
      expect(clientRegistered.type).toBe("registered");
      expect(clientRegistered.success).toBe(true);
      expect(isValidDeviceId(clientRegistered.deviceId)).toBe(true);

      // Verify IDs are distinct
      expect(hostRegistered.deviceId).not.toBe(clientRegistered.deviceId);

      // Check peer status of Host A from Client B
      wsClient.send(
        JSON.stringify({
          type: "peer-status-request",
          targetId: hostRegistered.deviceId,
        })
      );
      const statusRes = await waitForMessage(wsClient);
      expect(statusRes.type).toBe("peer-status-response");
      expect(statusRes.online).toBe(true);
      expect(statusRes.deviceName).toBe("Host Node Alpha");

      wsHost.close();
      wsClient.close();
    });

    it("should reject invalid payloads sent through websocket", async () => {
      const ws = await connectClient();

      // Send invalid JSON
      ws.send("not-a-valid-json");
      const jsonErr = await waitForMessage(ws);
      expect(jsonErr.type).toBe("error");
      expect(jsonErr.code).toBe("INVALID_JSON");

      // Send invalid schema payload
      ws.send(JSON.stringify({ type: "session-request", targetId: "short" }));
      const schemaErr = await waitForMessage(ws);
      expect(schemaErr.type).toBe("error");
      expect(schemaErr.code).toBe("INVALID_PAYLOAD");

      ws.close();
    });

    it("should handle session request, auth challenge, and rejection by invalid proof", async () => {
      const wsHost = await connectClient();
      const wsClient = await connectClient();

      // Register Host
      wsHost.send(
        JSON.stringify({
          type: "register-host",
          deviceName: "Host Workstation",
          unattendedEnabled: true,
        })
      );
      const hostReg = await waitForMessage(wsHost);
      const hostId = hostReg.deviceId;

      // Register Client
      wsClient.send(
        JSON.stringify({
          type: "register-host",
          deviceName: "Client Laptop",
          unattendedEnabled: false,
        })
      );
      const clientReg = await waitForMessage(wsClient);
      const clientId = clientReg.deviceId;

      // 1. Client sends session request to Host
      const hostPromiseMsg = waitForMessage(wsHost);
      wsClient.send(
        JSON.stringify({
          type: "session-request",
          targetId: hostId,
          clientName: "Client Laptop",
          clientDeviceId: clientId,
          hasUnattendedPassword: true,
        })
      );

      const receivedReq = await hostPromiseMsg;
      expect(receivedReq.type).toBe("session-request");
      expect(receivedReq.clientDeviceId).toBe(clientId);

      // 2. Host sends Auth Challenge (nonce & salt)
      const clientPromiseMsg1 = waitForMessage(wsClient);
      wsHost.send(
        JSON.stringify({
          type: "auth-challenge",
          targetId: clientId,
          senderId: hostId,
          nonce: "1234567890abcdef1234567890abcdef",
          salt: "random_salt_for_pbkdf2_12345678",
        })
      );

      const receivedChallenge = await clientPromiseMsg1;
      expect(receivedChallenge.type).toBe("auth-challenge");
      expect(receivedChallenge.nonce).toBe("1234567890abcdef1234567890abcdef");

      // 3. Client responds with invalid proof
      const hostPromiseMsg2 = waitForMessage(wsHost);
      wsClient.send(
        JSON.stringify({
          type: "auth-response",
          targetId: hostId,
          senderId: clientId,
          proof: "bad_invalid_proof_hash_that_fails_verification_32chars",
        })
      );

      const receivedResponse = await hostPromiseMsg2;
      expect(receivedResponse.type).toBe("auth-response");

      // 4. Host verifies proof, detects failure, and replies with session-rejected
      const clientPromiseMsg2 = waitForMessage(wsClient);
      wsHost.send(
        JSON.stringify({
          type: "session-rejected",
          targetId: clientId,
          senderId: hostId,
          reason: "Invalid unattended access password or proof.",
        })
      );

      const receivedRejection = await clientPromiseMsg2;
      expect(receivedRejection.type).toBe("session-rejected");
      expect(receivedRejection.reason).toContain("Invalid unattended access password");

      wsHost.close();
      wsClient.close();
    });
  });
});
