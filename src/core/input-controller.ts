import type { InputPacket } from "../shared/protocol";

export interface ViewportDimensions {
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
}

export interface InputControllerCallbacks {
  onInputPacket: (packet: InputPacket) => void;
  interceptClipboardShortcuts?: boolean;
  onRemoteCopyTriggered?: () => void;
}

export interface NormalizedCoordinates {
  x: number;
  y: number;
  outOfBounds: boolean;
}

/**
 * Normalizes coordinates between client viewport and remote display resolution
 * taking into account object-fit: contain letterboxing / pillarboxing.
 * Discards clicks and movements on letterboxed/pillarboxed black bars.
 */
export function calculateNormalizedCoordinates(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  videoWidth: number,
  videoHeight: number
): NormalizedCoordinates {
  const containerW = containerRect.width;
  const containerH = containerRect.height;

  if (containerW <= 0 || containerH <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return { x: 0, y: 0, outOfBounds: true };
  }

  const containerRatio = containerW / containerH;
  const videoRatio = videoWidth / videoHeight;

  let renderedW = containerW;
  let renderedH = containerH;
  let offsetX = 0;
  let offsetY = 0;

  if (containerRatio > videoRatio) {
    // Pillarboxed (vertical bars left & right)
    renderedH = containerH;
    renderedW = containerH * videoRatio;
    offsetX = (containerW - renderedW) / 2;
  } else {
    // Letterboxed (horizontal bars top & bottom)
    renderedW = containerW;
    renderedH = containerW / videoRatio;
    offsetY = (containerH - renderedH) / 2;
  }

  const localX = clientX - containerRect.left - offsetX;
  const localY = clientY - containerRect.top - offsetY;

  const rawXNorm = localX / renderedW;
  const rawYNorm = localY / renderedH;

  const outOfBounds = rawXNorm < 0 || rawXNorm > 1 || rawYNorm < 0 || rawYNorm > 1;

  const xNorm = Math.min(1, Math.max(0, rawXNorm));
  const yNorm = Math.min(1, Math.max(0, rawYNorm));

  return {
    x: Math.round(xNorm * 10000) / 10000,
    y: Math.round(yNorm * 10000) / 10000,
    outOfBounds,
  };
}

export class InputController {
  private element: HTMLElement | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private fallbackWidth = 0;
  private fallbackHeight = 0;
  private callbacks: InputControllerCallbacks;
  private isAttached = false;
  private lastMoveTime = 0;
  private readonly THROTTLE_MS = 8; // ~125Hz smooth mouse tracking without queue lag
  private pasteInterceptState: "idle" | "waiting" | "suppressed" = "idle";
  private pendingPasteTimer: number | null = null;
  private pendingPasteDispatch: (() => void) | null = null;
  private pendingPasteRelease: (() => void) | null = null;
  private pendingModifierUps: Array<() => void> = [];
  private releasedKeyVDuringWait = false;

  public markLocalPasteHandled(suppressRemoteKeyV: boolean, releaseDelayMs = 0): void {
    if (this.pendingPasteTimer !== null) {
      window.clearTimeout(this.pendingPasteTimer);
      this.pendingPasteTimer = null;
    }
    if (this.pasteInterceptState !== "waiting") return;
    if (suppressRemoteKeyV) {
      this.pasteInterceptState = "suppressed";
      this.pendingPasteDispatch = null;
      this.pendingPasteRelease = null;
      this.releasedKeyVDuringWait = false;
      this.flushDeferredModifierUps();
      return;
    }
    if (releaseDelayMs > 0) {
      this.pendingPasteTimer = window.setTimeout(() => {
        this.pendingPasteTimer = null;
        this.dispatchPendingPasteKeys();
      }, releaseDelayMs);
    } else {
      this.dispatchPendingPasteKeys();
    }
  }

  private flushDeferredModifierUps(): void {
    const queue = this.pendingModifierUps.splice(0, this.pendingModifierUps.length);
    for (const fn of queue) {
      fn();
    }
  }

  private dispatchPendingPasteKeys(): void {
    if (this.pasteInterceptState !== "waiting") return;
    const downFn = this.pendingPasteDispatch;
    const upFn = this.pendingPasteRelease;
    const shouldRelease = this.releasedKeyVDuringWait;
    this.pasteInterceptState = "idle";
    this.pendingPasteDispatch = null;
    this.pendingPasteRelease = null;
    this.releasedKeyVDuringWait = false;
    downFn?.();
    if (shouldRelease) {
      upFn?.();
    }
    this.flushDeferredModifierUps();
  }

  constructor(callbacks: InputControllerCallbacks) {
    this.callbacks = callbacks;
  }

  public setFallbackDimensions(width: number, height: number): void {
    this.fallbackWidth = width > 0 ? width : 0;
    this.fallbackHeight = height > 0 ? height : 0;
  }

  public attach(container: HTMLElement, video: HTMLVideoElement): void {
    if (this.isAttached) {
      this.detach();
    }
    this.element = container;
    this.videoElement = video;
    this.isAttached = true;

    container.tabIndex = 0; // Make focusable for keyboard capture
    container.addEventListener("mousemove", this.handleMouseMove, { passive: false });
    container.addEventListener("mousedown", this.handleMouseDown, { passive: false });
    container.addEventListener("mouseup", this.handleMouseUp, { passive: false });
    container.addEventListener("wheel", this.handleWheel, { passive: false });
    container.addEventListener("contextmenu", this.handleContextMenu, { passive: false });
    container.addEventListener("keydown", this.handleKeyDown, { passive: false });
    container.addEventListener("keyup", this.handleKeyUp, { passive: false });
  }

  public detach(): void {
    if (!this.element) return;
    this.element.removeEventListener("mousemove", this.handleMouseMove);
    this.element.removeEventListener("mousedown", this.handleMouseDown);
    this.element.removeEventListener("mouseup", this.handleMouseUp);
    this.element.removeEventListener("wheel", this.handleWheel);
    this.element.removeEventListener("contextmenu", this.handleContextMenu);
    this.element.removeEventListener("keydown", this.handleKeyDown);
    this.element.removeEventListener("keyup", this.handleKeyUp);
    this.element = null;
    this.videoElement = null;
    this.isAttached = false;
  }

  public sendSpecialKey(action: "ctrl-alt-del" | "lock" | "esc"): void {
    this.callbacks.onInputPacket({
      kind: "special-key",
      action,
    });
  }

  private getCoordinates(e: MouseEvent): NormalizedCoordinates {
    if (!this.element) return { x: 0, y: 0, outOfBounds: true };
    const rect = this.element.getBoundingClientRect();
    const vW =
      this.videoElement && this.videoElement.videoWidth > 0
        ? this.videoElement.videoWidth
        : this.fallbackWidth || 1920;
    const vH =
      this.videoElement && this.videoElement.videoHeight > 0
        ? this.videoElement.videoHeight
        : this.fallbackHeight || 1080;
    return calculateNormalizedCoordinates(e.clientX, e.clientY, rect, vW, vH);
  }

  private handleMouseMove = (e: MouseEvent): void => {
    e.preventDefault();
    const now = performance.now();
    if (now - this.lastMoveTime < this.THROTTLE_MS) {
      return;
    }
    this.lastMoveTime = now;

    const coords = this.getCoordinates(e);
    if (coords.outOfBounds) return;

    this.callbacks.onInputPacket({
      kind: "mouse-move",
      x: coords.x,
      y: coords.y,
    });
  };

  private handleMouseDown = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.element && document.activeElement !== this.element) {
      this.element.focus();
    }
    const coords = this.getCoordinates(e);
    // Ignore clicks on letterboxed/pillarboxed black bars to prevent accidental clicks at (0, 0)
    if (coords.outOfBounds) return;

    const button = this.resolveButton(e.button);
    this.callbacks.onInputPacket({
      kind: "mouse-down",
      button,
      x: coords.x,
      y: coords.y,
    });
  };

  private handleMouseUp = (e: MouseEvent): void => {
    e.preventDefault();
    const coords = this.getCoordinates(e);
    if (coords.outOfBounds) return;

    const button = this.resolveButton(e.button);
    this.callbacks.onInputPacket({
      kind: "mouse-up",
      button,
      x: coords.x,
      y: coords.y,
    });
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.callbacks.onInputPacket({
      kind: "mouse-wheel",
      deltaX: Math.sign(e.deltaX),
      deltaY: Math.sign(e.deltaY),
    });
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const emitKeyDown = (): void => {
      this.callbacks.onInputPacket({
        kind: "key-down",
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
      });
    };

    if (
      this.callbacks.interceptClipboardShortcuts &&
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      e.code === "KeyV" &&
      !e.repeat
    ) {
      // Allow browser's native paste event to fire synchronously before remote Ctrl+V
      if (this.pendingPasteTimer !== null) {
        window.clearTimeout(this.pendingPasteTimer);
      }
      this.pasteInterceptState = "waiting";
      this.releasedKeyVDuringWait = false;
      this.pendingModifierUps = [];
      this.pendingPasteDispatch = emitKeyDown;
      this.pendingPasteRelease = () => {
        this.callbacks.onInputPacket({
          kind: "key-up",
          key: e.key,
          code: e.code,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
        });
      };
      this.pendingPasteTimer = window.setTimeout(() => {
        this.pendingPasteTimer = null;
        this.dispatchPendingPasteKeys();
      }, 60);
      return;
    }

    // Intercept standard hotkeys like Ctrl+W, Tab, F5 when controlling remote
    e.preventDefault();
    emitKeyDown();

    if (
      this.callbacks.interceptClipboardShortcuts &&
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      e.code === "KeyC" &&
      !e.repeat
    ) {
      this.callbacks.onRemoteCopyTriggered?.();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const emitKeyUp = (): void => {
      this.callbacks.onInputPacket({
        kind: "key-up",
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
      });
    };

    if (this.pasteInterceptState === "suppressed" && e.code === "KeyV") {
      e.preventDefault();
      this.pasteInterceptState = "idle";
      return;
    }

    if (this.pasteInterceptState === "waiting") {
      if (e.code === "KeyV") {
        e.preventDefault();
        this.releasedKeyVDuringWait = true;
        this.pendingPasteRelease = emitKeyUp;
        return;
      }
      if (
        e.code === "ControlLeft" ||
        e.code === "ControlRight" ||
        e.code === "MetaLeft" ||
        e.code === "MetaRight"
      ) {
        e.preventDefault();
        this.pendingModifierUps.push(emitKeyUp);
        return;
      }
    }

    e.preventDefault();
    emitKeyUp();
  };

  private resolveButton(button: number): "left" | "right" | "middle" {
    if (button === 2) return "right";
    if (button === 1) return "middle";
    return "left";
  }
}
