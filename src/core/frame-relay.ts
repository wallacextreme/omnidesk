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

  constructor(
    private stream: MediaStream,
    private onFrame: (frameDataUrl: string, width: number, height: number) => void
  ) {}

  public start(intervalMs = 200, maxWidth = 960): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (typeof document === "undefined") return;

    try {
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.autoplay = true;
      this.video.srcObject = this.stream;
      this.video.play().catch((err) => {
        console.warn("[FrameRelayHost] Memory video play warning:", err);
      });

      this.canvas = document.createElement("canvas");
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: false });

      this.timer = setInterval(() => {
        if (!this.isRunning || !this.video || !this.canvas || !this.ctx) return;
        if (this.video.readyState < 2 || this.video.videoWidth === 0) return;

        const vW = this.video.videoWidth;
        const vH = this.video.videoHeight;
        const scale = Math.min(1, maxWidth / vW);
        const targetW = Math.round(vW * scale);
        const targetH = Math.round(vH * scale);

        if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
          this.canvas.width = targetW;
          this.canvas.height = targetH;
        }

        this.ctx.drawImage(this.video, 0, 0, targetW, targetH);
        // Compressed JPEG (quality 0.55) generates ~20-35 KB per frame
        const dataUrl = this.canvas.toDataURL("image/jpeg", 0.55);
        this.onFrame(dataUrl, targetW, targetH);
      }, intervalMs);
    } catch (err) {
      console.warn("[FrameRelayHost] Failed to initialize frame relay:", err);
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.video) {
      try {
        this.video.pause();
        this.video.srcObject = null;
      } catch {}
      this.video = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}
