import { test, expect } from "@playwright/test";

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

    // ========================================================
    // SCENARIO 4: Real-time Chat via WebRTC DataChannel
    // ========================================================
    // Client opens chat drawer
    const clientChatToggle = pageClient.locator('[data-testid="toggle-chat-btn"]');
    await clientChatToggle.click();

    const clientChatInput = pageClient.locator('[data-testid="chat-input"]');
    await expect(clientChatInput).toBeVisible({ timeout: 5000 });
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
});
