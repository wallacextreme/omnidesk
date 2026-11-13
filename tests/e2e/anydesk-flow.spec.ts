import { test, expect } from "@playwright/test";
import http from "node:http";
import crypto from "node:crypto";

async function startMockWindowsAgent() {
  const receivedPackets: Array<Record<string, unknown>> = [];
  const sockets = new Set<import("node:stream").Duplex>();

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      res.end(JSON.stringify({ ok: true, platform: "windows", port }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    sockets.add(socket);

    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const hello = Buffer.from(JSON.stringify({ type: "hello", platform: "windows", port }), "utf8");
    socket.write(Buffer.concat([Buffer.from([0x81, hello.length]), hello]));

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const opcode = buf[0]! & 0x0f;
        const masked = (buf[1]! & 0x80) !== 0;
        let payloadLen = buf[1]! & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buf.length < 4) return;
          payloadLen = buf.readUInt16BE(2);
          offset = 4;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + payloadLen) return;
        const payload = Buffer.alloc(payloadLen);
        if (masked) {
          const mask = buf.subarray(offset, offset + 4);
          for (let i = 0; i < payloadLen; i++) {
            payload[i] = buf[offset + 4 + i]! ^ mask[i % 4]!;
          }
        } else {
          buf.copy(payload, 0, offset, offset + payloadLen);
        }
        buf = buf.subarray(offset + maskLen + payloadLen);

        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
          continue;
        }
        if (opcode === 0x1) {
          try {
            receivedPackets.push(JSON.parse(payload.toString("utf8")) as Record<string, unknown>);
          } catch {
            // ignore non-json
          }
        }
      }
    });

    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    wsUrl: `ws://127.0.0.1:${port}`,
    receivedPackets,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test.describe("PulseDesk Pro E2E - Full AnyDesk Parity & Security Suite", () => {
  test("Complete Multi-Instance Remote Desktop Workflow", async ({ browser }) => {
    // 1. Create two isolated browser contexts (Host & Client)
    const contextHost = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const contextClient = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });

    const pageHost = await contextHost.newPage();
    const pageClient = await contextClient.newPage();

    // ========================================================
    // SCENARIO 1: Discovery & 9-Digit ID Allocation
    // ========================================================
    await pageHost.goto("http://localhost:5173");
    await pageClient.goto("http://localhost:5173");

    // Wait for both nodes to connect to Signaling Gateway and receive IDs
    const hostIdDisplay = pageHost.locator('[data-testid="device-id-display"]');
    const clientIdDisplay = pageClient.locator('[data-testid="device-id-display"]');

    await expect(hostIdDisplay).not.toHaveText("Obtendo ID...", { timeout: 10000 });
    await expect(clientIdDisplay).not.toHaveText("Obtendo ID...", { timeout: 10000 });

    const hostIdText = (await hostIdDisplay.innerText()).trim();
    const clientIdText = (await clientIdDisplay.innerText()).trim();

    expect(hostIdText).toMatch(/^\d{3}\s\d{3}\s\d{3}$/);
    expect(clientIdText).toMatch(/^\d{3}\s\d{3}\s\d{3}$/);
    expect(hostIdText).not.toBe(clientIdText);

    // Without native Windows Agent running, Dashboard offers 1-click download banner
    await expect(pageHost.locator('[data-testid="windows-agent-banner"]')).toBeVisible();
    await expect(pageHost.locator('[data-testid="download-agent-btn"]')).toBeVisible();

    // ========================================================
    // SCENARIO 2: Manual Handshake & WebRTC Session Establishment
    // ========================================================
    // Client enters Host's 9-digit ID into remote input
    const clientRemoteInput = pageClient.locator('[data-testid="remote-id-input"]');
    await clientRemoteInput.fill(hostIdText);

    // Client clicks "Conectar"
    const clientConnectBtn = pageClient.locator('[data-testid="connect-button"]');
    await clientConnectBtn.click();

    // Host receives incoming connection modal
    const hostModal = pageHost.locator('[data-testid="incoming-request-modal"]');
    await expect(hostModal).toBeVisible({ timeout: 10000 });

    // Host clicks "Aceitar"
    const hostAcceptBtn = pageHost.locator('[data-testid="accept-request-btn"]');
    await hostAcceptBtn.click();

    // Host displays active broadcast bar, Client displays remote viewport
    const hostActiveBar = pageHost.locator('[data-testid="host-active-bar"]');
    const clientViewport = pageClient.locator('[data-testid="remote-viewport"]');
    const waitingOverlay = pageClient.locator('[data-testid="waiting-video-overlay"]');

    await expect(hostActiveBar).toBeVisible({ timeout: 10000 });
    await expect(clientViewport).toBeVisible({ timeout: 10000 });
    // Waiting overlay must disappear once WebRTC or WSS Frame Relay delivers the first frame
    await expect(waitingOverlay).toBeHidden({ timeout: 15000 });

    // Confirm real visual output on Client (either hardware WebRTC video or WSS fallback frame)
    await expect(async () => {
      const hasVisualFrame = await pageClient.evaluate(() => {
        const video = document.querySelector('[data-testid="remote-video-element"]') as HTMLVideoElement | null;
        const img = document.querySelector('[data-testid="remote-fallback-image"]') as HTMLImageElement | null;
        const videoReady = Boolean(video && video.videoWidth > 0 && video.readyState >= 2);
        const imgReady = Boolean(img && img.complete && img.naturalWidth > 0);
        return videoReady || imgReady;
      });
      expect(hasVisualFrame).toBe(true);
    }).toPass({ timeout: 10000 });

    // ========================================================
    // SCENARIO 3: Input Injection & Host Zero-Trust ACL Guard
    // ========================================================
    // Client moves mouse over remote viewport
    await clientViewport.hover({ position: { x: 300, y: 200 } });
    await pageClient.mouse.move(400, 300);

    // Host toggles "Bloquear Input" in the HUD to revoke remote input permission
    const hostBlockInputBtn = pageHost.locator('[data-testid="toggle-input-block-btn"]');
    await hostBlockInputBtn.click();

    // Verify input block status on host
    await expect(hostBlockInputBtn).toHaveAttribute("title", /Input Bloqueado/);

    // Verify Host informs Client that OS-level agent is missing when running browser-only
    await expect(pageClient.locator('[data-testid="view-only-warning"]')).toBeVisible({ timeout: 10000 });

    // ========================================================
    // SCENARIO 4: Real-time Chat via WebRTC DataChannel (UI Focus Not Hijacked)
    // ========================================================
    // Client opens chat drawer
    const clientChatToggle = pageClient.locator('[data-testid="toggle-chat-btn"]');
    await clientChatToggle.click();

    const clientChatInput = pageClient.locator('[data-testid="chat-input"]');
    await expect(clientChatInput).toBeVisible({ timeout: 5000 });
    await clientChatInput.click();
    const isFocused = await clientChatInput.evaluate((el) => document.activeElement === el);
    expect(isFocused).toBe(true);
    await clientChatInput.fill("Olá do Cliente remoto! Teste de Ultra-Baixa Latência WebRTC.");

    const clientChatSend = pageClient.locator('[data-testid="chat-send-btn"]');
    await clientChatSend.click();

    // Host opens chat drawer to check received message
    const hostChatToggle = pageHost.locator('[data-testid="toggle-chat-btn"]');
    await hostChatToggle.click();

    const hostChatMessages = pageHost.locator('[data-testid="chat-message-item"]');
    await expect(hostChatMessages.first()).toContainText("Olá do Cliente remoto!", { timeout: 10000 });

    // ========================================================
    // SCENARIO 5: End Session Cleanup
    // ========================================================
    const clientEndSessionBtn = pageClient.locator('[data-testid="end-session-btn"]');
    await clientEndSessionBtn.click();

    // Both peers should return to the dashboard
    await expect(hostIdDisplay).toBeVisible({ timeout: 10000 });
    await expect(clientIdDisplay).toBeVisible({ timeout: 10000 });

    await contextHost.close();
    await contextClient.close();
  });

  test("Zero-Trust Unattended Access Workflow with PBKDF2 Challenge-Response", async ({ browser }) => {
    const contextHost = await browser.newContext();
    const contextClient = await browser.newContext();

    const pageHost = await contextHost.newPage();
    const pageClient = await contextClient.newPage();

    await pageHost.goto("http://localhost:5173");
    await pageClient.goto("http://localhost:5173");

    const hostIdDisplay = pageHost.locator('[data-testid="device-id-display"]');
    await expect(hostIdDisplay).not.toHaveText("Obtendo ID...", { timeout: 10000 });
    const hostId = (await hostIdDisplay.innerText()).trim();

    // Host configures unattended access password
    const hostPasswordInput = pageHost.locator('[data-testid="unattended-password-input"]');
    await hostPasswordInput.fill("P@sswordUnattended2026!");

    // Client connects using the same unattended password
    const clientPasswordInput = pageClient.locator('[data-testid="unattended-password-input"]');
    await clientPasswordInput.fill("P@sswordUnattended2026!");

    const clientRemoteInput = pageClient.locator('[data-testid="remote-id-input"]');
    await clientRemoteInput.fill(hostId);

    const clientConnectBtn = pageClient.locator('[data-testid="connect-button"]');
    await clientConnectBtn.click();

    // Direct entry: Host shows broadcast bar, Client shows remote viewport without human click on host modal!
    const hostActiveBar = pageHost.locator('[data-testid="host-active-bar"]');
    const clientViewport = pageClient.locator('[data-testid="remote-viewport"]');
    const waitingOverlay = pageClient.locator('[data-testid="waiting-video-overlay"]');

    await expect(hostActiveBar).toBeVisible({ timeout: 10000 });
    await expect(clientViewport).toBeVisible({ timeout: 10000 });
    await expect(waitingOverlay).toBeHidden({ timeout: 15000 });

    // Clean disconnect
    const clientEndSessionBtn = pageClient.locator('[data-testid="end-session-btn"]');
    await clientEndSessionBtn.click();

    await expect(hostIdDisplay).toBeVisible({ timeout: 10000 });

    await contextHost.close();
    await contextClient.close();
  });

  test("AnyDesk WSS Relay Fallback displays video & chat when WebRTC UDP/ICE is blocked", async ({
    browser,
  }) => {
    const contextHost = await browser.newContext();
    const contextClient = await browser.newContext();

    const pageHost = await contextHost.newPage();
    const pageClient = await contextClient.newPage();

    // Simulate strict Windows 7 / firewall environment where WebRTC ICE completely fails
    await pageClient.addInitScript(() => {
      const NativeRTCPC = window.RTCPeerConnection;
      class BlockedWebRTCPC extends NativeRTCPC {
        constructor(config?: RTCConfiguration) {
          super(config);
          setTimeout(() => {
            Object.defineProperty(this, "connectionState", {
              configurable: true,
              get: () => "failed",
            });
            this.onconnectionstatechange?.(new Event("connectionstatechange"));
          }, 300);
        }
        override async setRemoteDescription(_desc: RTCSessionDescriptionInit): Promise<void> {
          // Drop SDP/ICE exchange so WebRTC video track never connects
        }
      }
      window.RTCPeerConnection = BlockedWebRTCPC as unknown as typeof RTCPeerConnection;
    });

    await pageHost.goto("http://localhost:5173");
    await pageClient.goto("http://localhost:5173");

    const hostIdDisplay = pageHost.locator('[data-testid="device-id-display"]');
    const clientIdDisplay = pageClient.locator('[data-testid="device-id-display"]');
    await expect(hostIdDisplay).not.toHaveText("Obtendo ID...", { timeout: 10000 });
    await expect(clientIdDisplay).not.toHaveText("Obtendo ID...", { timeout: 10000 });
    const hostIdText = (await hostIdDisplay.innerText()).trim();

    await pageClient.locator('[data-testid="remote-id-input"]').fill(hostIdText);
    await pageClient.locator('[data-testid="connect-button"]').click();

    await expect(pageHost.locator('[data-testid="incoming-request-modal"]')).toBeVisible({
      timeout: 10000,
    });
    await pageHost.locator('[data-testid="accept-request-btn"]').click();

    // Even with WebRTC failed, session must stay open and show WSS Relay video!
    await expect(pageHost.locator('[data-testid="host-active-bar"]')).toBeVisible({ timeout: 10000 });
    await expect(pageClient.locator('[data-testid="remote-viewport"]')).toBeVisible({ timeout: 10000 });

    const fallbackImg = pageClient.locator('[data-testid="remote-fallback-image"]');
    await expect(fallbackImg).toBeVisible({ timeout: 15000 });
    await expect(pageClient.locator('[data-testid="waiting-video-overlay"]')).toBeHidden({
      timeout: 10000,
    });

    // Verify rendered fallback image actually has real pixels decoded
    const imgWidth = await fallbackImg.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(imgWidth).toBeGreaterThan(0);

    // Verify HUD explicitly indicates WSS Relay
    await expect(pageClient.locator('[data-testid="remote-viewport"]')).toContainText("WSS Relay");

    // Verify chat still works via WSS control-relay fallback even without WebRTC DataChannel
    await pageClient.locator('[data-testid="toggle-chat-btn"]').click();
    await pageClient.locator('[data-testid="chat-input"]').fill("Chat funcionando via WSS Relay!");
    await pageClient.locator('[data-testid="chat-send-btn"]').click();

    await pageHost.locator('[data-testid="toggle-chat-btn"]').click();
    await expect(pageHost.locator('[data-testid="chat-message-item"]').first()).toContainText(
      "Chat funcionando via WSS Relay!",
      { timeout: 10000 }
    );

    await pageClient.locator('[data-testid="end-session-btn"]').click();
    await expect(hostIdDisplay).toBeVisible({ timeout: 10000 });

    await contextHost.close();
    await contextClient.close();
  });

  test("Host forwards Client clicks & keystrokes via local Windows Agent loopback WebSocket", async ({
    browser,
  }) => {
    const mockAgent = await startMockWindowsAgent();
    const contextHost = await browser.newContext();
    const contextClient = await browser.newContext();

    const pageHost = await contextHost.newPage();
    const pageClient = await contextClient.newPage();

    await pageHost.addInitScript((agentUrl: string) => {
      localStorage.setItem("omnidesk_agent_url", agentUrl);
    }, mockAgent.wsUrl);

    try {
      await pageHost.goto("http://localhost:5173");
      await pageClient.goto("http://localhost:5173");

      const hostIdDisplay = pageHost.locator('[data-testid="device-id-display"]');
      const clientIdDisplay = pageClient.locator('[data-testid="device-id-display"]');
      await expect(hostIdDisplay).not.toHaveText("Obtendo ID...", { timeout: 10000 });
      await expect(clientIdDisplay).not.toHaveText("Obtendo ID...", { timeout: 10000 });
      const hostIdText = (await hostIdDisplay.innerText()).trim();

      // Host Dashboard detects native Windows Agent
      await expect(pageHost.locator('[data-testid="windows-agent-banner"]')).toContainText(
        "Controle Nativo Windows Ativo",
        { timeout: 10000 }
      );

      await pageClient.locator('[data-testid="remote-id-input"]').fill(hostIdText);
      await pageClient.locator('[data-testid="connect-button"]').click();

      await expect(pageHost.locator('[data-testid="incoming-request-modal"]')).toBeVisible({
        timeout: 10000,
      });
      await pageHost.locator('[data-testid="accept-request-btn"]').click();

      await expect(pageHost.locator('[data-testid="host-active-bar"]')).toBeVisible({ timeout: 10000 });
      await expect(pageHost.locator('[data-testid="host-native-control-badge"]')).toBeVisible({
        timeout: 10000,
      });
      await expect(pageClient.locator('[data-testid="remote-viewport"]')).toBeVisible({ timeout: 10000 });
      await expect(pageClient.locator('[data-testid="waiting-video-overlay"]')).toBeHidden({
        timeout: 15000,
      });

      // With Host agent active, Client should not show view-only warning
      await expect(pageClient.locator('[data-testid="view-only-warning"]')).toBeHidden();

      // Client can still click & type inside ChatDrawer without InputController stealing focus
      await pageClient.locator('[data-testid="toggle-chat-btn"]').click();
      const chatInput = pageClient.locator('[data-testid="chat-input"]');
      await chatInput.click();
      await expect(chatInput).toBeFocused();
      await pageClient.locator('[data-testid="toggle-chat-btn"]').click();

      // Click directly on remote capture overlay and send keystroke
      const captureOverlay = pageClient.locator('[data-testid="remote-input-capture"]');
      await expect(captureOverlay).toBeVisible();
      await captureOverlay.click({ position: { x: 240, y: 180 } });
      await pageClient.keyboard.press("KeyK");

      await expect
        .poll(
          () => ({
            mouseDown: mockAgent.receivedPackets.some(
              (p) => p.kind === "mouse-down" && p.button === "left"
            ),
            mouseUp: mockAgent.receivedPackets.some(
              (p) => p.kind === "mouse-up" && p.button === "left"
            ),
            keyDown: mockAgent.receivedPackets.some(
              (p) => p.kind === "key-down" && p.code === "KeyK"
            ),
            keyUp: mockAgent.receivedPackets.some(
              (p) => p.kind === "key-up" && p.code === "KeyK"
            ),
          }),
          { timeout: 10000 }
        )
        .toEqual({
          mouseDown: true,
          mouseUp: true,
          keyDown: true,
          keyUp: true,
        });

      await pageClient.locator('[data-testid="end-session-btn"]').click();
      await expect(hostIdDisplay).toBeVisible({ timeout: 10000 });

      await expect
        .poll(() => mockAgent.receivedPackets.some((p) => p.kind === "release-all"), {
          timeout: 5000,
        })
        .toBe(true);
    } finally {
      await contextHost.close();
      await contextClient.close();
      await mockAgent.close();
    }
  });
});
