import type {
  ACLPermissions,
  ControlChannelPacket,
  InputPacket,
  TransferChannelPacket,
} from "../shared/protocol";
import { DEFAULT_ACL_PERMISSIONS } from "../shared/protocol";
import { nativeBridge } from "./native-bridge";

export type ACLChangeListener = (permissions: ACLPermissions) => void;

/**
 * Host-Side Zero-Trust ACL Guard
 * Ensures that unauthorized input events, clipboard syncs, or file transfers
 * are intercepted and dropped before reaching OS injectors or filesystem bridges.
 */
export class ACLGuard {
  private permissions: ACLPermissions;
  private listeners = new Set<ACLChangeListener>();

  constructor(initialPermissions: Partial<ACLPermissions> = {}) {
    this.permissions = {
      allowInput: initialPermissions.allowInput ?? DEFAULT_ACL_PERMISSIONS.allowInput,
      allowClipboard: initialPermissions.allowClipboard ?? DEFAULT_ACL_PERMISSIONS.allowClipboard,
      allowFileTransfer: initialPermissions.allowFileTransfer ?? DEFAULT_ACL_PERMISSIONS.allowFileTransfer,
      allowAudio: initialPermissions.allowAudio ?? DEFAULT_ACL_PERMISSIONS.allowAudio,
    };
  }

  public getPermissions(): Readonly<ACLPermissions> {
    return { ...this.permissions };
  }

  public updatePermissions(updates: Partial<ACLPermissions>): void {
    let hasChanged = false;

    if (updates.allowInput !== undefined && updates.allowInput !== this.permissions.allowInput) {
      this.permissions.allowInput = updates.allowInput;
      hasChanged = true;
      if (!updates.allowInput) {
        nativeBridge.releaseAllInputs();
      }
    }
    if (updates.allowClipboard !== undefined && updates.allowClipboard !== this.permissions.allowClipboard) {
      this.permissions.allowClipboard = updates.allowClipboard;
      hasChanged = true;
    }
    if (updates.allowFileTransfer !== undefined && updates.allowFileTransfer !== this.permissions.allowFileTransfer) {
      this.permissions.allowFileTransfer = updates.allowFileTransfer;
      hasChanged = true;
    }
    if (updates.allowAudio !== undefined && updates.allowAudio !== this.permissions.allowAudio) {
      this.permissions.allowAudio = updates.allowAudio;
      hasChanged = true;
    }

    if (hasChanged) {
      this.notifyListeners();
    }
  }

  public setAll(permissions: ACLPermissions): void {
    const wasAllowInput = this.permissions.allowInput;
    this.permissions = { ...permissions };
    if (wasAllowInput && !this.permissions.allowInput) {
      nativeBridge.releaseAllInputs();
    }
    this.notifyListeners();
  }

  /**
   * Emergency Panic Button.
   * Immediately revokes all remote control permissions and releases any stuck keys or mouse buttons.
   */
  public triggerPanic(): void {
    this.permissions = {
      allowInput: false,
      allowClipboard: false,
      allowFileTransfer: false,
      allowAudio: false,
    };
    nativeBridge.releaseAllInputs();
    this.notifyListeners();
  }

  public addChangeListener(listener: ACLChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const current = this.getPermissions();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch (err) {
        console.error("[ACLGuard] Error in listener:", err);
      }
    }
  }

  /**
   * Filters input packets. Drops any mouse or keyboard action if allowInput is false.
   * Returns true if allowed, false if blocked.
   */
  public canExecuteInput(packet: InputPacket): boolean {
    if (!this.permissions.allowInput) {
      return false;
    }

    switch (packet.kind) {
      case "mouse-move":
      case "mouse-down":
      case "mouse-up":
      case "mouse-wheel":
      case "key-down":
      case "key-up":
      case "special-key":
        return true;
      default: {
        const _exhaustive: never = packet;
        return false;
      }
    }
  }

  /**
   * Verifies if incoming control packets are permitted.
   */
  public canExecuteControlPacket(packet: ControlChannelPacket): boolean {
    switch (packet.kind) {
      case "mouse-move":
      case "mouse-down":
      case "mouse-up":
      case "mouse-wheel":
      case "key-down":
      case "key-up":
      case "special-key":
        return this.permissions.allowInput;
      case "acl-update":
        return true;
      case "chat-message":
      case "telemetry":
        return true;
      default: {
        const _exhaustive: never = packet;
        return false;
      }
    }
  }

  /**
   * Verifies if clipboard synchronization is allowed.
   */
  public canSyncClipboard(): boolean {
    return this.permissions.allowClipboard;
  }

  /**
   * Verifies if file transfer packets are allowed.
   */
  public canTransferFile(): boolean {
    return this.permissions.allowFileTransfer;
  }

  /**
   * Filters transfer channel packets.
   */
  public canExecuteTransferPacket(packet: TransferChannelPacket): boolean {
    switch (packet.kind) {
      case "clipboard-sync":
        return this.permissions.allowClipboard;
      case "file-metadata":
      case "file-chunk":
      case "file-ack":
      case "file-complete":
      case "file-abort":
        return this.permissions.allowFileTransfer;
      default: {
        const _exhaustive: never = packet;
        return false;
      }
    }
  }
}
