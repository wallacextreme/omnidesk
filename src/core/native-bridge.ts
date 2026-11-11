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
  getMonitors(): Promise<MonitorInfo[]>;
  captureScreen(monitorId?: string): Promise<MediaStream>;
  injectInput(packet: InputPacket): Promise<boolean>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<boolean>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: {
      core?: {
        invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
      };
    };
  }
}

export class NativeBridge implements INativeBridge {
  private syntheticCanvas: HTMLCanvasElement | null = null;
  private syntheticAnimId: number | null = null;
  private forceSyntheticStream = false;

  public setForceSyntheticStream(enabled: boolean): void {
    this.forceSyntheticStream = enabled;
  }

  public isForceSyntheticStream(): boolean {
    return this.forceSyntheticStream;
  }

  public isDesktopApp(): boolean {
    return typeof window !== "undefined" && (Boolean(window.__TAURI__) || Boolean(window.__TAURI_INTERNALS__));
  }

  public async getMonitors(): Promise<MonitorInfo[]> {
    if (this.isDesktopApp() && window.__TAURI__?.core) {
      try {
        const monitors = await window.__TAURI__.core.invoke<MonitorInfo[]>("get_monitors");
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

  public async captureScreen(_monitorId?: string): Promise<MediaStream> {
    // If synthetic test stream is forced (e.g. testing on single machine without infinite mirror)
    if (this.forceSyntheticStream) {
      return this.createSyntheticStream();
    }

    // 1. In browser with getDisplayMedia support
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getDisplayMedia) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            frameRate: { ideal: 60, max: 60 },
            displaySurface: "monitor",
          },
          audio: false,
        });

        // Set contentHint for ultra-low latency motion
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && "contentHint" in videoTrack) {
          videoTrack.contentHint = "motion";
        }

        return stream;
      } catch (err) {
        console.warn("[NativeBridge] getDisplayMedia denied or not available, falling back to synthetic stream:", err);
      }
    }

    // 2. Synthetic stream fallback for automated testing / headless environments
    return this.createSyntheticStream();
  }

  public async injectInput(packet: InputPacket): Promise<boolean> {
    if (this.isDesktopApp() && window.__TAURI__?.core) {
      try {
        if (packet.kind.startsWith("mouse-")) {
          await window.__TAURI__.core.invoke("inject_mouse_event", { packet });
        } else if (packet.kind.startsWith("key-") || packet.kind === "special-key") {
          await window.__TAURI__.core.invoke("inject_key_event", { packet });
        }
        return true;
      } catch (err) {
        console.warn("[NativeBridge] Tauri native input injection error:", err);
      }
    }

    // Browser / test fallback: dispatch synthetic DOM event or mock injection
    if (typeof document !== "undefined") {
      const target = document.getElementById("remote-viewport-container") ?? document.body;
      if (packet.kind === "mouse-move") {
        const event = new MouseEvent("mousemove", {
          clientX: packet.x * window.innerWidth,
          clientY: packet.y * window.innerHeight,
          bubbles: true,
        });
        target.dispatchEvent(event);
      }
    }

    return true;
  }

  public async readClipboard(): Promise<string> {
    if (this.isDesktopApp() && window.__TAURI__?.core) {
      try {
        return await window.__TAURI__.core.invoke<string>("read_clipboard");
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

  public async writeClipboard(text: string): Promise<boolean> {
    if (this.isDesktopApp() && window.__TAURI__?.core) {
      try {
        await window.__TAURI__.core.invoke("write_clipboard", { text });
        return true;
      } catch {
        // fallback
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
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
      videoTrack.contentHint = "motion";
    }
    return stream;
  }
}

export const nativeBridge = new NativeBridge();
