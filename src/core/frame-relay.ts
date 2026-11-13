/**
 * OmniDesk AnyDesk-Style WSS Frame Relay Engine
 * Guaranteed 100% video delivery fallback over WSS signaling channel
 * when WebRTC UDP/STUN/TURN is blocked or slow on legacy systems (e.g. Windows 7).
 */

export class FrameRelayHost {
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isPaused = false;
  private maxWidth = 960;
  private intervalMs = 200;
  private adaptiveQuality = 0.58;
  private webpSupported: boolean | null = null;
  private lastFrameDataUrl = "";
  private lastSentAt = 0;

  constructor(
    private stream: MediaStream,
    private onFrame: (frameDataUrl: string, width: number, height: number) => void
  ) {}

  public start(intervalMs = 200, maxWidth = 960): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    this.intervalMs = intervalMs;
    this.maxWidth = maxWidth;
    this.lastFrameDataUrl = "";
    this.lastSentAt = 0;

    if (typeof document === "undefined") return;

    try {
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.autoplay = true;
      // Attach invisibly to DOM so Chrome 109 reliably decodes frames
      this.video.style.position = "fixed";
      this.video.style.left = "-9999px";
      this.video.style.top = "0px";
      this.video.style.width = "2px";
      this.video.style.height = "2px";
      this.video.style.opacity = "0.001";
      this.video.style.pointerEvents = "none";
      if (document.body) {
        document.body.appendChild(this.video);
      }

      this.video.srcObject = this.stream;
      this.video.onloadeddata = () => this.captureAndEmit(true);
      this.video.oncanplay = () => this.captureAndEmit(true);
      this.video.play().catch((err) => {
        console.warn("[FrameRelayHost] Memory video play warning:", err);
      });

      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });

      this.timer = setInterval(() => {
        this.captureAndEmit(false);
      }, this.intervalMs);
    } catch (err) {
      console.warn("[FrameRelayHost] Failed to initialize frame relay:", err);
    }
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    if (!this.isRunning) return;
    this.isPaused = false;
    this.lastFrameDataUrl = "";
    this.captureAndEmit(true);
  }

  public isPausedState(): boolean {
    return this.isPaused;
  }

  public updateStream(newStream: MediaStream): void {
    this.stream = newStream;
    this.lastFrameDataUrl = "";
    if (this.video) {
      this.video.srcObject = newStream;
      this.video.play().catch(() => {});
    }
  }

  private encodeCanvas(canvas: HTMLCanvasElement, quality: number): string {
    if (this.webpSupported === null) {
      const probe = canvas.toDataURL("image/webp", quality);
      this.webpSupported = probe.startsWith("data:image/webp");
      if (this.webpSupported) return probe;
    } else if (this.webpSupported) {
      return canvas.toDataURL("image/webp", quality);
    }
    return canvas.toDataURL("image/jpeg", quality);
  }

  private captureAndEmit(force: boolean): void {
    if (!this.isRunning || (this.isPaused && !force) || !this.video || !this.canvas || !this.ctx) {
      return;
    }
    if (this.video.readyState < 2 || this.video.videoWidth === 0) return;

    const vW = this.video.videoWidth;
    const vH = this.video.videoHeight;
    const scale = Math.min(1, this.maxWidth / vW);
    const targetW = Math.max(2, Math.round(vW * scale));
    const targetH = Math.max(2, Math.round(vH * scale));

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    this.ctx.drawImage(this.video, 0, 0, targetW, targetH);

    let dataUrl = this.encodeCanvas(this.canvas, this.adaptiveQuality);
    if (dataUrl.length > 85_000 && this.adaptiveQuality > 0.36) {
      this.adaptiveQuality = Math.max(0.36, this.adaptiveQuality - 0.1);
      dataUrl = this.encodeCanvas(this.canvas, this.adaptiveQuality);
    } else if (dataUrl.length < 40_000 && this.adaptiveQuality < 0.62) {
      this.adaptiveQuality = Math.min(0.62, this.adaptiveQuality + 0.04);
    }

    const now = Date.now();
    // Skip duplicate static desktop frames for up to 2s to preserve WSS broker bandwidth
    if (!force && dataUrl === this.lastFrameDataUrl && now - this.lastSentAt < 2000) {
      return;
    }

    this.lastFrameDataUrl = dataUrl;
    this.lastSentAt = now;
    this.onFrame(dataUrl, targetW, targetH);
  }

  public stop(): void {
    this.isRunning = false;
    this.isPaused = false;
    this.lastFrameDataUrl = "";
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.video) {
      try {
        this.video.onloadeddata = null;
        this.video.oncanplay = null;
        this.video.pause();
        this.video.srcObject = null;
        this.video.remove();
      } catch {}
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}
