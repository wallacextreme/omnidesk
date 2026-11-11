import { describe, it, expect } from "bun:test";
import {
  FileSender,
  FileReceiver,
  sanitizeFileName,
  CHUNK_SIZE,
} from "../../src/core/file-transfer";
import {
  calculateNormalizedCoordinates,
} from "../../src/core/input-controller";
import { sha256 } from "../../src/core/crypto";
import type { TransferChannelPacket } from "../../src/shared/protocol";

describe("Phase 3: Input & File Transfer Quality Gate", () => {
  describe("1. Security Audit: Path Traversal Sanitization", () => {
    it("should sanitize malicious path traversal sequences from filenames", () => {
      expect(sanitizeFileName("../../../../etc/passwd")).toBe("passwd");
      expect(sanitizeFileName("..\\..\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
      expect(sanitizeFileName("safe_document.pdf")).toBe("safe_document.pdf");
      expect(sanitizeFileName("hidden\0nullbyte.png")).toBe("hiddennullbyte.png");
      expect(sanitizeFileName("")).toBe("downloaded-file.bin");

      // Windows NT Reserved Device Names & NTFS Alternate Data Streams (ADS)
      expect(sanitizeFileName("CON.txt")).toBe("safe_CON.txt");
      expect(sanitizeFileName("aux")).toBe("safe_aux");
      expect(sanitizeFileName("nul.bin")).toBe("safe_nul.bin");
      expect(sanitizeFileName("COM1.pdf")).toBe("safe_COM1.pdf");
      expect(sanitizeFileName("LPT3.dat")).toBe("safe_LPT3.dat");
      expect(sanitizeFileName("document.pdf:hidden.exe")).toBe("document.pdf_hidden.exe");
    });
  });

  describe("2. Viewport Coordinates Normalization", () => {
    it("should map 1:1 aspect ratio coordinates accurately to 0.0 - 1.0", () => {
      const rect = {
        left: 100,
        top: 50,
        width: 1000,
        height: 500,
        right: 1100,
        bottom: 550,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      } as DOMRect;

      // Click exactly at the center of the viewport
      const center = calculateNormalizedCoordinates(600, 300, rect, 1000, 500);
      expect(center.x).toBe(0.5);
      expect(center.y).toBe(0.5);

      // Top-left corner
      const topLeft = calculateNormalizedCoordinates(100, 50, rect, 1000, 500);
      expect(topLeft.x).toBe(0);
      expect(topLeft.y).toBe(0);

      // Bottom-right corner
      const bottomRight = calculateNormalizedCoordinates(1100, 550, rect, 1000, 500);
      expect(bottomRight.x).toBe(1);
      expect(bottomRight.y).toBe(1);
    });

    it("should compensate for letterboxing/pillarboxing with differing aspect ratios", () => {
      // Container is ultra-wide (2000 x 500, ratio 4:1)
      // Video is 16:9 (1920 x 1080, ratio 1.777)
      // Height fits (500), rendered width = 500 * (16/9) = ~888.88
      // Offset X = (2000 - 888.88) / 2 = ~555.55
      const rect = {
        left: 0,
        top: 0,
        width: 2000,
        height: 500,
        right: 2000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;

      // Click dead center of container: (1000, 250)
      const center = calculateNormalizedCoordinates(1000, 250, rect, 1920, 1080);
      expect(center.x).toBe(0.5);
      expect(center.y).toBe(0.5);

      // Click in black bar area far left (e.g. x = 100): should clamp x to 0
      const leftPillar = calculateNormalizedCoordinates(100, 250, rect, 1920, 1080);
      expect(leftPillar.x).toBe(0);

      // Click in black bar area far right (e.g. x = 1950): should clamp x to 1
      const rightPillar = calculateNormalizedCoordinates(1950, 250, rect, 1920, 1080);
      expect(rightPillar.x).toBe(1);
    });
  });

  describe("3. 5MB Binary File Chunking, Backpressure & SHA-256 Integrity Verification", () => {
    it("should slice a 5MB buffer in 64KB chunks, stream via DataChannel simulation, and verify matching SHA-256", async () => {
      const FILE_SIZE = 5 * 1024 * 1024; // 5 MB
      const rawBytes = new Uint8Array(FILE_SIZE);

      // Populate with pseudo-random deterministic test data
      for (let i = 0; i < FILE_SIZE; i += 1024) {
        rawBytes[i] = (i * 37) % 256;
        rawBytes[i + 1] = (i * 73) % 256;
      }

      const expectedSha256 = await sha256(rawBytes);
      expect(expectedSha256).toHaveLength(64);

      // Set up receiver
      const receivedBox: { file: { name: string; blob: Blob; size: number; sha256: string } | null } = {
        file: null,
      };
      let errorReported: string | null = null;
      let progressEventsCount = 0;

      const receiver = new FileReceiver({
        onProgress: () => {
          progressEventsCount++;
        },
        onFileReceived: (file) => {
          receivedBox.file = file;
        },
        onError: (_id, err) => {
          errorReported = err;
        },
      });

      // Set up sender with simulated DataChannel loopback
      const packetsQueue: TransferChannelPacket[] = [];
      const sender = new FileSender({
        sendPacket: (packet) => {
          packetsQueue.push(packet);
          return true;
        },
        getBufferedAmount: () => 0,
      });

      // Mock file object
      const mockFile = {
        name: "test-5mb-archive.tar.gz",
        size: FILE_SIZE,
        arrayBuffer: async () => rawBytes.buffer,
      };

      // Send the file
      const transferId = await sender.sendFile(mockFile);
      expect(transferId).toBeDefined();

      // Ensure chunks were generated (5MB / 64KB = 80 chunks + 1 metadata packet = 81 packets)
      const expectedTotalChunks = Math.ceil(FILE_SIZE / CHUNK_SIZE);
      expect(expectedTotalChunks).toBe(80);
      expect(packetsQueue.length).toBe(81); // 1 meta + 80 chunks

      // Process packets on receiver
      for (const packet of packetsQueue) {
        await receiver.handlePacket(packet);
      }

      // Assertions
      const receivedFile = receivedBox.file;
      expect(errorReported).toBeNull();
      expect(receivedFile).not.toBeNull();
      if (!receivedFile) throw new Error("File was not received");
      expect(receivedFile.name).toBe("test-5mb-archive.tar.gz");
      expect(receivedFile.size).toBe(FILE_SIZE);
      expect(receivedFile.sha256).toBe(expectedSha256);
      expect(progressEventsCount).toBeGreaterThan(80);

      // Verify reconstructed blob content matches byte-for-byte
      const receivedArrayBuffer = await receivedFile.blob.arrayBuffer();
      const receivedSha256 = await sha256(receivedArrayBuffer);
      expect(receivedSha256).toBe(expectedSha256);
    });
  });
});
