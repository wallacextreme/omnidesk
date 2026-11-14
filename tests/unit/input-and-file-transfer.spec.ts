import { describe, it, expect } from "bun:test";
import {
  FileSender,
  FileReceiver,
  sanitizeFileName,
  CHUNK_SIZE,
} from "../../src/core/file-transfer";
import {
  InputController,
  calculateNormalizedCoordinates,
} from "../../src/core/input-controller";
import { sha256 } from "../../src/core/crypto";
import { NativeBridge } from "../../src/core/native-bridge";
import { ACLGuard } from "../../src/core/acl-guard";
import type { InputPacket, TransferChannelPacket } from "../../src/shared/protocol";

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
      expect(center.outOfBounds).toBe(false);

      // Click in black bar area far left (e.g. x = 100): should clamp x to 0 and mark outOfBounds
      const leftPillar = calculateNormalizedCoordinates(100, 250, rect, 1920, 1080);
      expect(leftPillar.x).toBe(0);
      expect(leftPillar.outOfBounds).toBe(true);

      // Click in black bar area far right (e.g. x = 1950): should clamp x to 1 and mark outOfBounds
      const rightPillar = calculateNormalizedCoordinates(1950, 250, rect, 1920, 1080);
      expect(rightPillar.x).toBe(1);
      expect(rightPillar.outOfBounds).toBe(true);
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

      // Ensure chunks were generated dynamically based on CHUNK_SIZE
      const expectedTotalChunks = Math.ceil(FILE_SIZE / CHUNK_SIZE);
      expect(expectedTotalChunks).toBe(320); // 5MB / 16KB = 320 chunks
      expect(packetsQueue.length).toBe(expectedTotalChunks + 1); // 1 meta + 320 chunks

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

  describe("4. NativeBridge Loopback Agent WebSocket Dispatch", () => {
    it("should connect to local Windows agent over loopback WS and forward input & release-all packets", async () => {
      const receivedPackets: Array<Record<string, unknown>> = [];
      const server = Bun.serve({
        port: 0,
        fetch(req, srv) {
          const url = new URL(req.url);
          if (url.pathname === "/health") {
            return new Response(
              JSON.stringify({ ok: true, platform: "windows", port: srv.port }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          }
          if (srv.upgrade(req)) {
            return;
          }
          return new Response("Not Found", { status: 404 });
        },
        websocket: {
          open(ws) {
            ws.send(JSON.stringify({ type: "hello", platform: "windows", port: server.port }));
          },
          message(_ws, message) {
            try {
              const text = typeof message === "string" ? message : new TextDecoder().decode(message);
              receivedPackets.push(JSON.parse(text) as Record<string, unknown>);
            } catch {
              // ignore non-json
            }
          },
        },
      });

      const originalWindow = (globalThis as Record<string, unknown>).window;
      const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
      const store = new Map<string, string>([
        ["omnidesk_agent_url", `ws://127.0.0.1:${server.port}`],
      ]);
      const mockStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => {
          store.set(key, val);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      };

      (globalThis as Record<string, unknown>).localStorage = mockStorage;
      if (typeof originalWindow === "undefined") {
        (globalThis as Record<string, unknown>).window = { localStorage: mockStorage };
      }

      const bridge = new NativeBridge();
      try {
        const connected = await bridge.probeAgentNow();
        expect(connected).toBe(true);
        expect(bridge.getControlStatus()).toBe("agent-connected");
        expect(bridge.hasNativeOSControl()).toBe(true);

        await bridge.injectInput({ kind: "mouse-down", button: "left", x: 0.5, y: 0.25 });
        await bridge.injectInput({
          kind: "key-down",
          code: "KeyA",
          key: "a",
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
        });
        await bridge.releaseAllInputs();

        const deadline = Date.now() + 2000;
        while (receivedPackets.length < 3 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 20));
        }

        expect(receivedPackets.some((p) => p.kind === "mouse-down" && p.button === "left" && p.x === 0.5 && p.y === 0.25)).toBe(true);
        expect(receivedPackets.some((p) => p.kind === "key-down" && p.code === "KeyA" && p.key === "a")).toBe(true);
        expect(receivedPackets.some((p) => p.kind === "release-all")).toBe(true);

        // Save received file into Windows Agent (with autoPaste) & receive clipboard events
        const events: string[] = [];
        const unsub = bridge.subscribeAgentEvents((ev) => {
          events.push(ev.kind);
        });
        const sampleBytes = new TextEncoder().encode("OmniDesk Unit File");
        const savedOk = await bridge.saveReceivedFileToAgent(
          "unit-doc.txt",
          sampleBytes.buffer.slice(
            sampleBytes.byteOffset,
            sampleBytes.byteOffset + sampleBytes.byteLength
          ),
          true
        );
        expect(savedOk).toBe(true);
        await new Promise((r) => setTimeout(r, 40));
        expect(
          receivedPackets.some(
            (p) =>
              p.kind === "save-file-start" &&
              p.fileName === "unit-doc.txt" &&
              p.autoPaste === true
          )
        ).toBe(true);
        expect(receivedPackets.some((p) => p.kind === "save-file-chunk")).toBe(true);
        expect(receivedPackets.some((p) => p.kind === "save-file-end")).toBe(true);
        unsub();
      } finally {
        bridge.stopAgentDiscovery();
        server.stop(true);
        if (originalLocalStorage === undefined) {
          delete (globalThis as Record<string, unknown>).localStorage;
        } else {
          (globalThis as Record<string, unknown>).localStorage = originalLocalStorage;
        }
        if (originalWindow === undefined) {
          delete (globalThis as Record<string, unknown>).window;
        } else {
          (globalThis as Record<string, unknown>).window = originalWindow;
        }
      }
    });
  });

  describe("5. AutoPaste Metadata & ACL Guards", () => {
    it("should preserve autoPaste flag across FileSender/FileReceiver and enforce ACL for new packets", async () => {
      const packets: TransferChannelPacket[] = [];
      let receivedAutoPaste: boolean | undefined;
      const sender = new FileSender({
        sendPacket: (pkt) => {
          packets.push(pkt);
          return true;
        },
        getBufferedAmount: () => 0,
        onProgress: () => {},
      });
      const receiver = new FileReceiver({
        sendPacket: () => true,
        onProgress: () => {},
        onFileReceived: (f) => {
          receivedAutoPaste = f.autoPaste;
        },
      });

      const file = new File([new Uint8Array([1, 2, 3, 4])], "pasted.txt", { type: "text/plain" });
      await sender.sendFile(file, { autoPaste: true });
      for (const pkt of packets) {
        await receiver.handlePacket(pkt);
      }
      expect(receivedAutoPaste).toBe(true);

      const guard = new ACLGuard({
        allowInput: false,
        allowClipboard: false,
        allowFileTransfer: false,
        allowAudio: false,
      });
      expect(guard.canExecuteControlPacket({ kind: "stream-quality", quality: "original" })).toBe(true);
      expect(guard.canExecuteTransferPacket({ kind: "clipboard-sync", text: "abc", timestamp: 1 })).toBe(false);
      expect(
        guard.canExecuteTransferPacket({
          kind: "clipboard-files-ready",
          files: [{ id: "1", name: "a.txt", size: 10 }],
        })
      ).toBe(false);
      expect(
        guard.canExecuteTransferPacket({ kind: "clipboard-file-request", id: "1" })
      ).toBe(false);

      guard.updatePermissions({ allowFileTransfer: true, allowClipboard: true });
      expect(
        guard.canExecuteTransferPacket({ kind: "clipboard-file-request", id: "1" })
      ).toBe(true);
    });
  });

  describe("6. Stuck Modifier Recovery & Concurrent Multi-File Receiver", () => {
    it("should release stale Alt/Ctrl modifiers before mouse clicks and emit release-all on blur", () => {
      const originalWindow = (globalThis as Record<string, unknown>).window;
      const originalDocument = (globalThis as Record<string, unknown>).document;

      const makeTarget = () => {
        const listeners = new Map<string, Set<(ev: unknown) => void>>();
        return {
          tabIndex: 0,
          addEventListener: (type: string, fn: (ev: unknown) => void) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
          },
          removeEventListener: (type: string, fn: (ev: unknown) => void) => {
            listeners.get(type)?.delete(fn);
          },
          dispatch: (type: string, ev: Record<string, unknown>) => {
            for (const fn of listeners.get(type) ?? []) {
              fn(ev);
            }
          },
          focus: () => {},
          getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: 1000,
            height: 500,
            right: 1000,
            bottom: 500,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }),
        };
      };

      const winTarget = makeTarget();
      const docTarget = {
        ...makeTarget(),
        activeElement: null as unknown,
        visibilityState: "visible",
      };
      const container = makeTarget();
      (globalThis as Record<string, unknown>).window = winTarget;
      (globalThis as Record<string, unknown>).document = docTarget;

      const emitted: InputPacket[] = [];
      const controller = new InputController({
        onInputPacket: (pkt) => emitted.push(pkt),
      });

      try {
        controller.attach(container as unknown as HTMLElement, {
          videoWidth: 1000,
          videoHeight: 500,
        } as HTMLVideoElement);

        // Simulate Alt pressed (e.g. Alt+Tab) without corresponding keyup
        container.dispatch("keydown", {
          key: "Alt",
          code: "AltLeft",
          altKey: true,
          ctrlKey: false,
          shiftKey: false,
          metaKey: false,
          repeat: false,
          preventDefault: () => {},
        });

        // Next click arrives with altKey=false: must release AltLeft BEFORE mouse-down
        container.dispatch("mousedown", {
          button: 0,
          clientX: 500,
          clientY: 250,
          altKey: false,
          ctrlKey: false,
          shiftKey: false,
          metaKey: false,
          preventDefault: () => {},
        });

        const keyUpIdx = emitted.findIndex((p) => p.kind === "key-up" && p.code === "AltLeft");
        const mouseDownIdx = emitted.findIndex((p) => p.kind === "mouse-down");
        expect(keyUpIdx).toBeGreaterThan(-1);
        expect(mouseDownIdx).toBeGreaterThan(keyUpIdx);

        // Focus loss emits release-all
        winTarget.dispatch("blur", {});
        expect(emitted[emitted.length - 1]).toEqual({ kind: "release-all" });

        // ACLGuard must always permit release-all even when allowInput=false
        const guard = new ACLGuard({ allowInput: false });
        expect(guard.canExecuteControlPacket({ kind: "release-all" })).toBe(true);
      } finally {
        controller.detach();
        if (originalWindow === undefined) {
          delete (globalThis as Record<string, unknown>).window;
        } else {
          (globalThis as Record<string, unknown>).window = originalWindow;
        }
        if (originalDocument === undefined) {
          delete (globalThis as Record<string, unknown>).document;
        } else {
          (globalThis as Record<string, unknown>).document = originalDocument;
        }
      }
    });

    it("should receive concurrent multi-file chunks independently without clobbering earlier transfers", async () => {
      const packetsA: TransferChannelPacket[] = [];
      const packetsB: TransferChannelPacket[] = [];
      const received: Array<{ name: string; bytes: Uint8Array; sha256: string }> = [];

      const senderA = new FileSender({
        sendPacket: (p) => {
          packetsA.push(p);
          return true;
        },
        getBufferedAmount: () => 0,
      });
      const senderB = new FileSender({
        sendPacket: (p) => {
          packetsB.push(p);
          return true;
        },
        getBufferedAmount: () => 0,
      });

      const receiver = new FileReceiver({
        sendPacket: () => true,
        onFileReceived: (f) => {
          void f.blob.arrayBuffer().then((buf) => {
            received.push({ name: f.name, bytes: new Uint8Array(buf), sha256: f.sha256 });
          });
        },
      });

      const payloadA = new Uint8Array(CHUNK_SIZE + 512).fill(0x41);
      const payloadB = new Uint8Array(CHUNK_SIZE + 256).fill(0x42);
      await senderA.sendFile(new File([payloadA], "OmniDesk_1.0.0_x64.msi"));
      await senderB.sendFile(new File([payloadB], "OmniDesk_portable_x64.exe"));

      // Interleave metadata and chunk packets from both transfers
      const maxLen = Math.max(packetsA.length, packetsB.length);
      for (let i = 0; i < maxLen; i++) {
        if (packetsA[i]) await receiver.handlePacket(packetsA[i]!);
        if (packetsB[i]) await receiver.handlePacket(packetsB[i]!);
      }
      await new Promise((r) => setTimeout(r, 30));

      expect(received.length).toBe(2);
      const msi = received.find((f) => f.name === "OmniDesk_1.0.0_x64.msi");
      const exe = received.find((f) => f.name === "OmniDesk_portable_x64.exe");
      expect(msi?.bytes.length).toBe(payloadA.length);
      expect(exe?.bytes.length).toBe(payloadB.length);
      expect(msi?.sha256).toBe(await sha256(payloadA));
      expect(exe?.sha256).toBe(await sha256(payloadB));
    });
  });
});
