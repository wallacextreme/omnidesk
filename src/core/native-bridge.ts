import type { InputPacket } from "../shared/protocol";

export interface MonitorInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

export interface INativeBridge {
  isDesktopApp(): boolean;
  hasNativeScreenCapture(): boolean;
  getMonitors(): Promise<MonitorInfo[]>;
  captureScreen(monitorId?: string): Promise<MediaStream>;
  injectInput(packet: InputPacket): Promise<boolean>;
  releaseAllInputs(): Promise<boolean>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<boolean>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    __TAURI__?: {
      core?: {
        invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
      };
    };
  }
}

export type ControlBridgeStatus = "tauri" | "agent-connected" | "browser-only";

export class NativeBridge implements INativeBridge {
  private syntheticCanvas: HTMLCanvasElement | null = null;
  private syntheticAnimId: number | null = null;
  private forceSyntheticStream = false;
  private agentWs: WebSocket | null = null;
  private agentStatus: ControlBridgeStatus = "browser-only";
  private statusListeners = new Set<(status: ControlBridgeStatus) => void>();
  private probeInFlight = false;
  private fastPollTimer: ReturnType<typeof setInterval> | null = null;
  private idlePollTimer: ReturnType<typeof setInterval> | null = null;
  private focusHandler: (() => void) | null = null;
  private discoveryActive = false;
  private agentCaps = new Set<string>();
  private clipboardSnapshotWaiters: Array<
    (files: Array<{ id: string; name: string; size: number; mimeType: string }>) => void
  > = [];
  private fileSavedWaiters = new Map<string, (saved: boolean) => void>();
  private agentFileReadyWaiters = new Map<
    string,
    (file: { id: string; name: string; mimeType: string; size: number; data: ArrayBuffer }) => void
  >();
  private tauriClipboardFiles = new Map<string, { id: string; name: string; size: number }>();
  private tauriClipboardPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastTauriClipboardSeq: number | null = null;
  private ignoreTauriClipboardSeq: number | null = null;
  private lastTauriClipboardText = "";

  constructor() {
    if (this.isDesktopApp()) {
      this.agentStatus = "tauri";
    }
  }

  public getControlStatus(): ControlBridgeStatus {
    if (this.isDesktopApp()) return "tauri";
    return this.agentStatus;
  }

  public hasNativeOSControl(): boolean {
    const status = this.getControlStatus();
    return status === "tauri" || status === "agent-connected";
  }

  public subscribeControlStatus(listener: (status: ControlBridgeStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.getControlStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setControlStatus(next: ControlBridgeStatus): void {
    if (this.agentStatus !== next) {
      this.agentStatus = next;
      for (const listener of this.statusListeners) {
        try {
          listener(next);
        } catch {}
      }
    }
  }

  private getAgentWsUrl(): string {
    try {
      if (typeof localStorage !== "undefined") {
        const custom = localStorage.getItem("omnidesk_agent_url");
        if (custom && (custom.startsWith("ws://127.0.0.1") || custom.startsWith("ws://localhost"))) {
          return custom;
        }
      }
    } catch {}
    return "ws://127.0.0.1:47831";
  }

  public startAgentDiscovery(): void {
    if (typeof window === "undefined" || this.isDesktopApp() || this.discoveryActive) return;
    this.discoveryActive = true;

    const isWebDriver = Boolean((navigator as { webdriver?: boolean }).webdriver);
    let hasCustomAgent = false;
    try {
      hasCustomAgent = Boolean(localStorage.getItem("omnidesk_agent_url"));
    } catch {}

    // Probe once on mount (skip background polling under WebDriver unless explicitly configured)
    if (!isWebDriver || hasCustomAgent) {
      void this.probeAgentNow();
    }

    this.focusHandler = () => {
      if (!this.hasNativeOSControl()) {
        void this.probeAgentNow();
      }
    };
    window.addEventListener("focus", this.focusHandler);

    if (!isWebDriver || hasCustomAgent) {
      this.idlePollTimer = setInterval(() => {
        if (this.discoveryActive && !this.hasNativeOSControl() && document.visibilityState === "visible") {
          void this.probeAgentNow();
        }
      }, 15000);
    }
  }

  public stopAgentDiscovery(): void {
    this.discoveryActive = false;
    if (this.fastPollTimer) {
      clearInterval(this.fastPollTimer);
      this.fastPollTimer = null;
    }
    if (this.idlePollTimer) {
      clearInterval(this.idlePollTimer);
      this.idlePollTimer = null;
    }
    if (this.focusHandler && typeof window !== "undefined") {
      window.removeEventListener("focus", this.focusHandler);
      this.focusHandler = null;
    }
  }

  public startFastAgentPolling(durationMs = 60_000): void {
    if (typeof window === "undefined" || this.isDesktopApp()) return;
    if (this.fastPollTimer) {
      clearInterval(this.fastPollTimer);
    }
    const deadline = Date.now() + durationMs;
    void this.probeAgentNow();
    this.fastPollTimer = setInterval(() => {
      if (this.hasNativeOSControl() || Date.now() > deadline || !this.discoveryActive) {
        if (this.fastPollTimer) {
          clearInterval(this.fastPollTimer);
          this.fastPollTimer = null;
        }
        return;
      }
      void this.probeAgentNow();
    }, 2000);
  }

  public async probeAgentNow(): Promise<boolean> {
    if (this.isDesktopApp()) {
      this.setControlStatus("tauri");
      return true;
    }
    if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
      this.setControlStatus("agent-connected");
      return true;
    }
    if (this.probeInFlight || typeof WebSocket === "undefined") {
      return false;
    }

    this.probeInFlight = true;
    const wsUrl = this.getAgentWsUrl();
    const httpHealthUrl = wsUrl.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:").replace(/\/$/, "") + "/health";

    try {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 800) : null;
      const res = await fetch(httpHealthUrl, {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        this.probeInFlight = false;
        return false;
      }
    } catch {
      this.probeInFlight = false;
      this.setControlStatus("browser-only");
      return false;
    }

    return new Promise<boolean>((resolve) => {
      try {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          this.probeInFlight = false;
          try {
            ws.close();
          } catch {}
          resolve(false);
        }, 1500);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.probeInFlight = false;
          this.agentWs = ws;
          ws.onmessage = (ev) => {
            if (typeof ev.data === "string") {
              this.handleAgentWsMessage(ev.data);
            }
          };
          this.setControlStatus("agent-connected");
          resolve(true);
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          this.probeInFlight = false;
          if (this.agentWs === ws) {
            this.agentWs = null;
            this.agentCaps.clear();
            this.flushPendingAgentWaiters();
          }
          this.setControlStatus(this.isDesktopApp() ? "tauri" : "browser-only");
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          this.probeInFlight = false;
          if (this.agentWs === ws) {
            this.agentWs = null;
            this.agentCaps.clear();
            this.flushPendingAgentWaiters();
          }
          this.setControlStatus(this.isDesktopApp() ? "tauri" : "browser-only");
          resolve(false);
        };
      } catch {
        this.probeInFlight = false;
        this.setControlStatus("browser-only");
        resolve(false);
      }
    });
  }

  public setForceSyntheticStream(enabled: boolean): void {
    this.forceSyntheticStream = enabled;
  }

  public isForceSyntheticStream(): boolean {
    return this.forceSyntheticStream;
  }

  public isDesktopApp(): boolean {
    return typeof window !== "undefined" && (Boolean(window.__TAURI__) || Boolean(window.__TAURI_INTERNALS__));
  }

  private async invokeTauri<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (typeof window !== "undefined") {
      if (window.__TAURI__?.core?.invoke) {
        return await window.__TAURI__.core.invoke<T>(cmd, args);
      }
      if (window.__TAURI_INTERNALS__?.invoke) {
        return await window.__TAURI_INTERNALS__.invoke<T>(cmd, args);
      }
    }
    throw new Error("Tauri invoke bridge unavailable");
  }

  public async getMonitors(): Promise<MonitorInfo[]> {
    if (this.isDesktopApp()) {
      try {
        const monitors = await this.invokeTauri<MonitorInfo[]>("get_monitors");
        return monitors;
      } catch (err) {
        console.warn("[NativeBridge] Tauri get_monitors failed, using fallback:", err);
      }
    }

    // Browser fallback
    return [
      {
        id: "screen-primary",
        name: "Primary Display",
        width: typeof window !== "undefined" ? window.screen.width : 1920,
        height: typeof window !== "undefined" ? window.screen.height : 1080,
        isPrimary: true,
      },
    ];
  }

  public hasNativeScreenCapture(): boolean {
    if (this.isDesktopApp()) {
      return true;
    }
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices !== "undefined" &&
      typeof navigator.mediaDevices.getDisplayMedia === "function"
    );
  }

  private syntheticStreams = new WeakSet<MediaStream>();

  public isSyntheticStream(stream: MediaStream | null | undefined): boolean {
    return Boolean(stream && this.syntheticStreams.has(stream));
  }

  private async captureTauriScreenFrame(
    maxWidth = 1280,
    quality = 68
  ): Promise<{ dataUrl: string; width: number; height: number } | null> {
    if (!this.isDesktopApp()) return null;
    try {
      const res = await this.invokeTauri<{ data_url: string; width: number; height: number }>(
        "capture_screen_frame",
        { maxWidth, quality }
      );
      if (res && typeof res.data_url === "string" && res.data_url.startsWith("data:image/")) {
        return { dataUrl: res.data_url, width: res.width, height: res.height };
      }
    } catch (err) {
      console.warn("[NativeBridge] Tauri capture_screen_frame failed:", err);
    }
    return null;
  }

  public async captureSingleFrame(
    maxWidth = 960,
    quality = 0.58
  ): Promise<{ dataUrl: string; width: number; height: number } | null> {
    if (this.isDesktopApp() && !this.forceSyntheticStream) {
      return await this.captureTauriScreenFrame(
        maxWidth,
        Math.round(Math.max(25, Math.min(95, quality * 100)))
      );
    }
    return null;
  }

  private drawDataUrlToCanvas(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    dataUrl: string,
    width: number,
    height: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const targetW = Math.max(2, img.naturalWidth || width);
        const targetH = Math.max(2, img.naturalHeight || height);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = dataUrl;
    });
  }

  private async createTauriNativeScreenStream(): Promise<MediaStream | null> {
    if (typeof document === "undefined" || !this.isDesktopApp()) return null;
    const initial = await this.captureTauriScreenFrame(1280, 72);
    if (!initial) return null;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, initial.width);
    canvas.height = Math.max(2, initial.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    await this.drawDataUrlToCanvas(canvas, ctx, initial.dataUrl, initial.width, initial.height);
    if (typeof canvas.captureStream !== "function") return null;

    const stream = canvas.captureStream(15);
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return null;
    if ("contentHint" in videoTrack) {
      videoTrack.contentHint = "detail";
    }

    let stopped = false;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    const stopLoop = () => {
      stopped = true;
      if (nextTimer) {
        clearTimeout(nextTimer);
        nextTimer = null;
      }
    };

    const origStop = videoTrack.stop.bind(videoTrack);
    videoTrack.stop = () => {
      stopLoop();
      origStop();
    };
    videoTrack.addEventListener("ended", stopLoop);

    const scheduleNext = () => {
      if (stopped || videoTrack.readyState !== "live") {
        stopLoop();
        return;
      }
      nextTimer = setTimeout(() => {
        void pumpNext();
      }, 66);
    };

    const pumpNext = async () => {
      if (stopped || videoTrack.readyState !== "live") {
        stopLoop();
        return;
      }
      const frame = await this.captureTauriScreenFrame(1280, 68);
      if (stopped || videoTrack.readyState !== "live") {
        stopLoop();
        return;
      }
      if (frame) {
        await this.drawDataUrlToCanvas(canvas, ctx, frame.dataUrl, frame.width, frame.height);
      }
      scheduleNext();
    };

    scheduleNext();
    return stream;
  }

  public async captureScreen(
    _monitorId?: string,
    options?: { allowSyntheticFallback?: boolean }
  ): Promise<MediaStream> {
    const allowSyntheticFallback = options?.allowSyntheticFallback ?? true;

    // If synthetic test stream is forced (e.g. testing on single machine without infinite mirror)
    if (this.forceSyntheticStream) {
      const synth = this.createSyntheticStream();
      this.syntheticStreams.add(synth);
      return synth;
    }

    // 0. In Tauri desktop app, capture the Windows desktop directly via leak-free Win32 GDI
    if (this.isDesktopApp()) {
      const nativeStream = await this.createTauriNativeScreenStream();
      if (nativeStream) {
        return nativeStream;
      }
    }

    // 1. In browser with getDisplayMedia support (Secure context HTTPS or localhost)
    if (this.hasNativeScreenCapture()) {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 30, max: 60 },
            displaySurface: "monitor",
            cursor: "never",
          } as MediaTrackConstraints & { cursor?: string },
          audio: false,
        });
      } catch (firstErr) {
        const errName = firstErr instanceof DOMException ? firstErr.name : "";
        // User explicitly cancelled or denied permission
        if (errName === "NotAllowedError" || errName === "AbortError") {
          if (!allowSyntheticFallback) {
            throw firstErr;
          }
          console.warn(
            "[NativeBridge] getDisplayMedia cancelled/denied by user, falling back to synthetic stream:",
            firstErr
          );
        } else {
          // Retry with minimal constraints for legacy Chrome 109 / Windows 7 GPU drivers
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false,
            });
          } catch (retryErr) {
            if (!allowSyntheticFallback) {
              throw retryErr;
            }
            console.warn(
              "[NativeBridge] getDisplayMedia minimal retry failed, falling back to synthetic stream:",
              retryErr
            );
          }
        }
      }

      if (stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && "contentHint" in videoTrack) {
          videoTrack.contentHint = "detail";
        }
        return stream;
      }
    } else {
      const isHttpLan =
        typeof window !== "undefined" &&
        window.location.protocol === "http:" &&
        window.location.hostname !== "localhost" &&
        window.location.hostname !== "127.0.0.1";

      if (isHttpLan) {
        console.warn(
          "[NativeBridge] navigator.mediaDevices.getDisplayMedia is undefined in non-secure HTTP context.\n" +
            "Para habilitar captura da tela real no Chrome via IP local (http://" +
            (window.location.host || "192.168.x.x") +
            "):\n" +
            "1. Abra chrome://flags/#unsafely-treat-insecure-origin-as-secure no navegador.\n" +
            "2. Adicione http://" +
            (window.location.host || "192.168.x.x") +
            " e selecione 'Enabled'.\n" +
            "3. Reinicie o Chrome.\n" +
            "Ou acesse via HTTPS oficial (https://omnidesk-remote.web.app).\n" +
            "Fallback ativo: Transmitindo fluxo sintético."
        );
      }
    }

    // 2. Synthetic stream fallback for automated testing / headless environments / unattended mode
    const synth = this.createSyntheticStream();
    this.syntheticStreams.add(synth);
    return synth;
  }

  public async injectInput(packet: InputPacket): Promise<boolean> {
    if (this.isDesktopApp()) {
      try {
        if (packet.kind.startsWith("mouse-")) {
          await this.invokeTauri("inject_mouse_event", { packet });
        } else if (
          packet.kind.startsWith("key-") ||
          packet.kind === "special-key" ||
          packet.kind === "release-all"
        ) {
          await this.invokeTauri("inject_key_event", { packet });
        }
        return true;
      } catch (err) {
        console.warn("[NativeBridge] Tauri native input injection error:", err);
      }
    }

    // Native OS Windows Agent over trusted loopback bridge (127.0.0.1:47831)
    if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
      try {
        this.agentWs.send(JSON.stringify(packet));
        return true;
      } catch (err) {
        console.warn("[NativeBridge] Loopback agent send failed:", err);
      }
    }

    // Browser-only DOM fallback (can interact only inside this browser tab)
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      if (packet.kind === "mouse-move" || packet.kind === "mouse-down" || packet.kind === "mouse-up") {
        const cx = packet.x * window.innerWidth;
        const cy = packet.y * window.innerHeight;
        const target =
          (typeof document.elementFromPoint === "function" ? document.elementFromPoint(cx, cy) : null) ??
          document.getElementById("remote-viewport-container") ??
          document.body;

        const buttonCode = packet.kind === "mouse-move" ? 0 : packet.button === "right" ? 2 : packet.button === "middle" ? 1 : 0;
        const eventType =
          packet.kind === "mouse-move" ? "mousemove" : packet.kind === "mouse-down" ? "mousedown" : "mouseup";

        target.dispatchEvent(
          new MouseEvent(eventType, {
            clientX: cx,
            clientY: cy,
            button: buttonCode,
            bubbles: true,
            cancelable: true,
          })
        );

        if (packet.kind === "mouse-up" && buttonCode === 0 && target instanceof HTMLElement) {
          target.focus?.();
          target.dispatchEvent(
            new MouseEvent("click", {
              clientX: cx,
              clientY: cy,
              button: 0,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      } else if (packet.kind === "key-down" || packet.kind === "key-up") {
        const target = (document.activeElement as HTMLElement | null) ?? document.body;
        target.dispatchEvent(
          new KeyboardEvent(packet.kind === "key-down" ? "keydown" : "keyup", {
            key: packet.key,
            code: packet.code,
            altKey: packet.altKey,
            ctrlKey: packet.ctrlKey,
            shiftKey: packet.shiftKey,
            metaKey: packet.metaKey,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    }

    return true;
  }

  public async releaseAllInputs(): Promise<boolean> {
    if (this.isDesktopApp()) {
      try {
        await this.invokeTauri("release_all_inputs");
        return true;
      } catch (err) {
        console.warn("[NativeBridge] Tauri release_all_inputs error:", err);
      }
    }
    if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
      try {
        this.agentWs.send(JSON.stringify({ kind: "release-all" }));
      } catch {}
    }
    return true;
  }

  public async readClipboard(): Promise<string> {
    if (this.isDesktopApp()) {
      try {
        return await this.invokeTauri<string>("read_clipboard");
      } catch {
        // fallback
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return "";
      }
    }
    return "";
  }

  private agentEventListeners = new Set<
    (
      event:
        | { kind: "clipboard-text"; text: string }
        | {
            kind: "clipboard-files";
            files: Array<{ id: string; name: string; size: number; mimeType: string }>;
          }
        | { kind: "file-saved"; path: string; name: string; autoPaste: boolean }
        | {
            kind: "agent-clipboard-file-ready";
            id: string;
            name: string;
            mimeType: string;
            size: number;
            data: ArrayBuffer;
          }
    ) => void
  >();

  private incomingAgentFiles = new Map<
    string,
    {
      id: string;
      name: string;
      mimeType: string;
      size: number;
      totalChunks: number;
      chunks: Array<Uint8Array | undefined>;
    }
  >();

  public subscribeAgentEvents(
    listener: (
      event:
        | { kind: "clipboard-text"; text: string }
        | {
            kind: "clipboard-files";
            files: Array<{ id: string; name: string; size: number; mimeType: string }>;
          }
        | { kind: "file-saved"; path: string; name: string; autoPaste: boolean }
        | {
            kind: "agent-clipboard-file-ready";
            id: string;
            name: string;
            mimeType: string;
            size: number;
            data: ArrayBuffer;
          }
    ) => void
  ): () => void {
    this.agentEventListeners.add(listener);
    if (this.isDesktopApp() && this.agentEventListeners.size === 1) {
      this.startTauriClipboardMonitor();
    }
    return () => {
      this.agentEventListeners.delete(listener);
      if (this.agentEventListeners.size === 0) {
        this.stopTauriClipboardMonitor();
      }
    };
  }

  private flushPendingAgentWaiters(): void {
    const snapWaiters = this.clipboardSnapshotWaiters.splice(0, this.clipboardSnapshotWaiters.length);
    for (const cb of snapWaiters) {
      try {
        cb([]);
      } catch {}
    }
    for (const [, cb] of this.fileSavedWaiters) {
      try {
        cb(false);
      } catch {}
    }
    this.fileSavedWaiters.clear();
    this.agentFileReadyWaiters.clear();
  }

  private startTauriClipboardMonitor(): void {
    if (this.tauriClipboardPollTimer || !this.isDesktopApp()) return;
    let polling = false;
    void (async () => {
      try {
        this.lastTauriClipboardSeq = await this.invokeTauri<number>("get_clipboard_sequence");
      } catch {
        this.lastTauriClipboardSeq = null;
      }
    })();

    this.tauriClipboardPollTimer = setInterval(() => {
      if (polling || this.agentEventListeners.size === 0) return;
      // Avoid duplicate events if the external OmniDesk Agent WebSocket is also connected
      if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) return;
      polling = true;
      void (async () => {
        try {
          const seq = await this.invokeTauri<number>("get_clipboard_sequence");
          if (this.lastTauriClipboardSeq !== null && seq === this.lastTauriClipboardSeq) {
            return;
          }
          this.lastTauriClipboardSeq = seq;
          if (this.ignoreTauriClipboardSeq !== null && seq === this.ignoreTauriClipboardSeq) {
            this.ignoreTauriClipboardSeq = null;
            return;
          }

          const files = await this.invokeTauri<Array<{ id: string; name: string; size: number }>>(
            "read_clipboard_files"
          );
          if (Array.isArray(files) && files.length > 0) {
            this.tauriClipboardFiles.clear();
            const normalized = files.map((f) => {
              this.tauriClipboardFiles.set(f.id, f);
              return {
                id: f.id,
                name: f.name,
                size: f.size,
                mimeType: "application/octet-stream",
              };
            });
            this.emitAgentEvent({ kind: "clipboard-files", files: normalized });
            return;
          }

          const text = await this.invokeTauri<string>("read_clipboard");
          if (text && text !== this.lastTauriClipboardText) {
            this.lastTauriClipboardText = text;
            this.emitAgentEvent({ kind: "clipboard-text", text });
          }
        } catch {
          // Clipboard temporarily busy or unavailable
        } finally {
          polling = false;
        }
      })();
    }, 650);
  }

  private stopTauriClipboardMonitor(): void {
    if (this.tauriClipboardPollTimer) {
      clearInterval(this.tauriClipboardPollTimer);
      this.tauriClipboardPollTimer = null;
    }
  }

  private emitAgentEvent(
    event:
      | { kind: "clipboard-text"; text: string }
      | {
          kind: "clipboard-files";
          files: Array<{ id: string; name: string; size: number; mimeType: string }>;
        }
      | { kind: "file-saved"; path: string; name: string; autoPaste: boolean }
      | {
          kind: "agent-clipboard-file-ready";
          id: string;
          name: string;
          mimeType: string;
          size: number;
          data: ArrayBuffer;
        }
  ): void {
    this.agentEventListeners.forEach((cb) => {
      try {
        cb(event);
      } catch {
        // Ignore listener errors
      }
    });
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(slice));
    }
    return btoa(binary);
  }

  private base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const len = binary.length;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }

  private parseAgentClipboardFiles(
    rawList: unknown[]
  ): Array<{ id: string; name: string; size: number; mimeType: string }> {
    const files: Array<{ id: string; name: string; size: number; mimeType: string }> = [];
    for (const item of rawList) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (
          typeof rec.id === "string" &&
          typeof rec.name === "string" &&
          typeof rec.size === "number"
        ) {
          files.push({
            id: rec.id,
            name: rec.name,
            size: rec.size,
            mimeType:
              typeof rec.mimeType === "string" && rec.mimeType
                ? rec.mimeType
                : "application/octet-stream",
          });
        }
      }
    }
    return files;
  }

  private handleAgentWsMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>;
      if (msg.type === "hello") {
        this.agentCaps.clear();
        if (Array.isArray(msg.caps)) {
          for (const cap of msg.caps) {
            if (typeof cap === "string") {
              this.agentCaps.add(cap);
            }
          }
        }
        return;
      }

      const kind = msg.kind;
      if (kind === "clipboard-text" && typeof msg.text === "string") {
        this.emitAgentEvent({ kind: "clipboard-text", text: msg.text });
        return;
      }
      if (kind === "clipboard-files-snapshot" && Array.isArray(msg.files)) {
        const files = this.parseAgentClipboardFiles(msg.files);
        const waiter = this.clipboardSnapshotWaiters.shift();
        waiter?.(files);
        return;
      }
      if (kind === "clipboard-files" && Array.isArray(msg.files)) {
        const files = this.parseAgentClipboardFiles(msg.files);
        if (files.length > 0) {
          this.emitAgentEvent({ kind: "clipboard-files", files });
        }
        return;
      }
      if (kind === "file-saved" && typeof msg.name === "string" && typeof msg.path === "string") {
        if (typeof msg.fileId === "string") {
          const waiter = this.fileSavedWaiters.get(msg.fileId);
          if (waiter) {
            this.fileSavedWaiters.delete(msg.fileId);
            waiter(true);
          }
        }
        this.emitAgentEvent({
          kind: "file-saved",
          path: msg.path,
          name: msg.name,
          autoPaste: msg.autoPaste === true,
        });
        return;
      }
      if (
        kind === "agent-file-start" &&
        typeof msg.id === "string" &&
        typeof msg.name === "string" &&
        typeof msg.size === "number" &&
        typeof msg.totalChunks === "number"
      ) {
        this.incomingAgentFiles.set(msg.id, {
          id: msg.id,
          name: msg.name,
          mimeType:
            typeof msg.mimeType === "string" && msg.mimeType
              ? msg.mimeType
              : "application/octet-stream",
          size: msg.size,
          totalChunks: Math.max(0, msg.totalChunks),
          chunks: new Array<Uint8Array | undefined>(Math.max(0, msg.totalChunks)),
        });
        return;
      }
      if (
        kind === "agent-file-chunk" &&
        typeof msg.id === "string" &&
        typeof msg.index === "number" &&
        typeof msg.dataB64 === "string"
      ) {
        const entry = this.incomingAgentFiles.get(msg.id);
        if (entry && msg.index >= 0) {
          entry.chunks[msg.index] = this.base64ToBytes(msg.dataB64);
        }
        return;
      }
      if (kind === "agent-file-end" && typeof msg.id === "string") {
        const entry = this.incomingAgentFiles.get(msg.id);
        this.incomingAgentFiles.delete(msg.id);
        if (!entry) return;
        let totalBytes = 0;
        for (const c of entry.chunks) {
          if (c) totalBytes += c.length;
        }
        const assembled = new Uint8Array(totalBytes);
        let offset = 0;
        for (const c of entry.chunks) {
          if (!c) continue;
          assembled.set(c, offset);
          offset += c.length;
        }
        const buffer = assembled.buffer.slice(
          assembled.byteOffset,
          assembled.byteOffset + assembled.byteLength
        );
        const readyPayload = {
          kind: "agent-clipboard-file-ready" as const,
          id: entry.id,
          name: entry.name,
          mimeType: entry.mimeType,
          size: totalBytes,
          data: buffer,
        };
        const waiter = this.agentFileReadyWaiters.get(entry.id);
        if (waiter) {
          this.agentFileReadyWaiters.delete(entry.id);
          waiter(readyPayload);
        }
        this.emitAgentEvent(readyPayload);
      }
    } catch {
      // Ignore malformed messages from local agent
    }
  }

  private async readTauriClipboardFileBuffer(fileId: string, expectedSize: number): Promise<ArrayBuffer> {
    const chunkLen = 1024 * 1024;
    const total = Math.max(0, expectedSize);
    const out = new Uint8Array(total);
    let offset = 0;
    while (offset < total || (total === 0 && offset === 0)) {
      const b64 = await this.invokeTauri<string>("read_clipboard_file_chunk", {
        id: fileId,
        offset,
        length: chunkLen,
      });
      if (!b64) break;
      const bytes = this.base64ToBytes(b64);
      if (bytes.length === 0) break;
      const copyLen = Math.min(bytes.length, out.length - offset);
      out.set(bytes.subarray(0, copyLen), offset);
      offset += copyLen;
      if (total === 0 || bytes.length < chunkLen) break;
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + offset);
  }

  public requestAgentClipboardFile(fileId: string): boolean {
    if (this.isDesktopApp() && fileId.startsWith("tcf-")) {
      const meta = this.tauriClipboardFiles.get(fileId);
      if (!meta) return false;
      void (async () => {
        try {
          const data = await this.readTauriClipboardFileBuffer(meta.id, meta.size);
          this.emitAgentEvent({
            kind: "agent-clipboard-file-ready",
            id: meta.id,
            name: meta.name,
            mimeType: "application/octet-stream",
            size: data.byteLength,
            data,
          });
        } catch (err) {
          console.warn("[NativeBridge] Tauri read_clipboard_file_chunk error:", err);
        }
      })();
      return true;
    }
    if (!this.agentWs || this.agentWs.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.agentWs.send(JSON.stringify({ kind: "request-clipboard-file", id: fileId }));
      return true;
    } catch {
      return false;
    }
  }

  public async getNativeClipboardFileEntries(): Promise<
    Array<{ id: string; name: string; size: number; mimeType: string }>
  > {
    if (this.isDesktopApp()) {
      try {
        const files = await this.invokeTauri<Array<{ id: string; name: string; size: number }>>(
          "read_clipboard_files"
        );
        if (Array.isArray(files) && files.length > 0) {
          this.tauriClipboardFiles.clear();
          return files.map((f) => {
            this.tauriClipboardFiles.set(f.id, f);
            return {
              id: f.id,
              name: f.name,
              size: f.size,
              mimeType: "application/octet-stream",
            };
          });
        }
      } catch {
        // Fallback to agent WS if running
      }
    }

    if (
      this.agentWs &&
      this.agentWs.readyState === WebSocket.OPEN &&
      this.agentCaps.has("clipboard-files")
    ) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (files: Array<{ id: string; name: string; size: number; mimeType: string }>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(files);
        };
        const timer = setTimeout(() => {
          const idx = this.clipboardSnapshotWaiters.indexOf(done);
          if (idx >= 0) this.clipboardSnapshotWaiters.splice(idx, 1);
          done([]);
        }, 250);
        this.clipboardSnapshotWaiters.push(done);
        try {
          this.agentWs?.send(JSON.stringify({ kind: "get-clipboard-files" }));
        } catch {
          const idx = this.clipboardSnapshotWaiters.indexOf(done);
          if (idx >= 0) this.clipboardSnapshotWaiters.splice(idx, 1);
          done([]);
        }
      });
    }

    return [];
  }

  public async readNativeClipboardFile(entry: {
    id: string;
    name: string;
    size: number;
    mimeType: string;
  }): Promise<File | null> {
    if (this.isDesktopApp() && entry.id.startsWith("tcf-")) {
      try {
        const buf = await this.readTauriClipboardFileBuffer(entry.id, entry.size);
        return new File([buf], entry.name, {
          type: entry.mimeType || "application/octet-stream",
        });
      } catch {
        return null;
      }
    }
    if (!this.agentWs || this.agentWs.readyState !== WebSocket.OPEN) {
      return null;
    }

    return new Promise<File | null>((resolve) => {
      let settled = false;
      const finish = (file: File | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.agentFileReadyWaiters.delete(entry.id);
        resolve(file);
      };
      const timer = setTimeout(() => finish(null), 15000);
      this.agentFileReadyWaiters.set(entry.id, (ready) => {
        finish(
          new File([ready.data], ready.name, {
            type: ready.mimeType || "application/octet-stream",
          })
        );
      });
      if (!this.requestAgentClipboardFile(entry.id)) {
        finish(null);
      }
    });
  }

  public async readClipboardFiles(): Promise<File[]> {
    const entries = await this.getNativeClipboardFileEntries();
    if (entries.length === 0) return [];
    const results: File[] = [];
    for (const entry of entries) {
      const f = await this.readNativeClipboardFile(entry);
      if (f) results.push(f);
    }
    return results;
  }

  public async saveReceivedFileToAgent(
    fileName: string,
    data: ArrayBuffer,
    autoPaste = false
  ): Promise<boolean> {
    if (this.isDesktopApp()) {
      try {
        const savedPath = await this.invokeTauri<string>("save_received_file", {
          fileName,
          dataB64: this.bytesToBase64(new Uint8Array(data)),
          autoPaste,
        });
        try {
          this.ignoreTauriClipboardSeq = await this.invokeTauri<number>("get_clipboard_sequence");
        } catch {}
        this.emitAgentEvent({
          kind: "file-saved",
          path: savedPath,
          name: fileName,
          autoPaste,
        });
        return true;
      } catch (err) {
        console.warn("[NativeBridge] Tauri save_received_file error:", err);
      }
    }
    if (!this.agentWs || this.agentWs.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      const ws = this.agentWs;
      const bytes = new Uint8Array(data);
      const chunkBytes = 64 * 1024;
      const totalChunks = Math.max(1, Math.ceil(bytes.length / chunkBytes));
      const fileId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const expectSavedAck = this.agentCaps.has("save-file-start");

      ws.send(
        JSON.stringify({
          kind: "save-file-start",
          fileId,
          fileName,
          totalSize: bytes.length,
          totalChunks,
          autoPaste,
        })
      );

      for (let i = 0; i < totalChunks; i++) {
        if (ws.readyState !== WebSocket.OPEN) {
          return false;
        }
        const start = i * chunkBytes;
        const end = Math.min(start + chunkBytes, bytes.length);
        const slice = bytes.subarray(start, end);
        ws.send(
          JSON.stringify({
            kind: "save-file-chunk",
            fileId,
            index: i,
            dataB64: this.bytesToBase64(slice),
          })
        );
        if (i % 16 === 15) {
          await new Promise((r) => setTimeout(r, 4));
        }
      }

      if (ws.readyState !== WebSocket.OPEN) {
        return false;
      }

      const savedAckPromise = expectSavedAck
        ? new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => {
              this.fileSavedWaiters.delete(fileId);
              resolve(false);
            }, 6000);
            this.fileSavedWaiters.set(fileId, (ok) => {
              clearTimeout(timer);
              resolve(ok);
            });
          })
        : null;

      ws.send(JSON.stringify({ kind: "save-file-end", fileId }));
      return savedAckPromise ? await savedAckPromise : true;
    } catch {
      return false;
    }
  }

  public async writeClipboard(text: string): Promise<boolean> {
    let wroteViaAgent = false;
    if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
      try {
        this.agentWs.send(JSON.stringify({ kind: "set-clipboard-text", text }));
        wroteViaAgent = true;
      } catch {
        // Ignore and continue to browser clipboard
      }
    }
    if (this.isDesktopApp()) {
      try {
        await this.invokeTauri("write_clipboard", { text });
        this.lastTauriClipboardText = text;
        try {
          this.ignoreTauriClipboardSeq = await this.invokeTauri<number>("get_clipboard_sequence");
        } catch {}
        return true;
      } catch {
        // fallback
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      if (wroteViaAgent) {
        // Best-effort browser clipboard sync alongside OS agent
        navigator.clipboard.writeText(text).catch(() => {});
        return true;
      }
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  public stopSyntheticStream(): void {
    if (this.syntheticAnimId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.syntheticAnimId);
      this.syntheticAnimId = null;
    }
  }

  private createSyntheticStream(): MediaStream {
    if (typeof document === "undefined") {
      // In non-DOM environment, create a dummy MediaStream if available
      return typeof MediaStream !== "undefined" ? new MediaStream() : ({} as MediaStream);
    }

    if (!this.syntheticCanvas) {
      this.syntheticCanvas = document.createElement("canvas");
      this.syntheticCanvas.width = 1280;
      this.syntheticCanvas.height = 720;
    }

    const canvas = this.syntheticCanvas;
    const ctx = canvas.getContext("2d");

    let angle = 0;
    const renderLoop = () => {
      if (!ctx) return;
      angle += 0.03;
      ctx.fillStyle = "#090d16";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw dynamic HUD radar
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 140, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("OmniDesk Pro - Active 60 FPS Stream", cx, cy - 20);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "18px monospace";
      ctx.fillText(new Date().toISOString(), cx, cy + 25);

      if (typeof requestAnimationFrame !== "undefined") {
        this.syntheticAnimId = requestAnimationFrame(renderLoop);
      }
    };

    renderLoop();

    const stream = canvas.captureStream(60);
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && "contentHint" in videoTrack) {
      videoTrack.contentHint = "detail";
    }
    return stream;
  }
}

export const nativeBridge = new NativeBridge();
