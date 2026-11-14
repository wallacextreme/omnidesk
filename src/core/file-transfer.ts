import { sha256, safeRandomUUID } from "./crypto";
import type {
  FileMetadataPacket,
  FileChunkPacket,
  FileAckPacket,
  FileCompletePacket,
  FileAbortPacket,
  TransferChannelPacket,
} from "../shared/protocol";

export const CHUNK_SIZE = 16 * 1024; // 16 KB (optimized for WebRTC SCTP stack without fragmentation)
export const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MB backpressure limit

export interface FileTransferProgress {
  transferId: string;
  fileName: string;
  fileSize: number;
  transferredBytes: number;
  totalChunks: number;
  currentChunk: number;
  progressPercent: number;
  speedMBps: number;
  etaSeconds: number;
  status: "idle" | "transferring" | "verifying" | "completed" | "failed";
  error?: string;
}

const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export function sanitizeFileName(rawName: string): string {
  // 1. Strip null bytes, CR, LF, and ASCII control characters (0-31, 127)
  let clean = rawName.replace(/[\x00-\x1f\x7f\0\r\n]/g, "");

  // 2. Extract basename (strip leading directories and path traversal attempts)
  clean = clean.replace(/^.*[\\\/]/, "").replace(/\.\.+[\\\/]/g, "");

  // 3. Block NTFS Alternate Data Streams (strip/replace colon ':')
  clean = clean.replace(/:/g, "_");

  // 4. Strip Windows illegal filesystem characters (<, >, ", |, ?, *)
  clean = clean.replace(/[<>"|?*]/g, "_");

  // 5. Trim leading/trailing whitespace and trailing dots (invalid in Windows FAT/NTFS)
  clean = clean.trim().replace(/^[\.\s]+|[\.\s]+$/g, "");

  // 6. Block Windows NT reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  if (WINDOWS_RESERVED_NAMES.test(clean)) {
    clean = `safe_${clean}`;
  }

  return clean || "downloaded-file.bin";
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      binary += String.fromCharCode(byte);
    }
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface FileSenderCallbacks {
  sendPacket: (packet: TransferChannelPacket) => boolean;
  getBufferedAmount: () => number;
  isRelayTransport?: () => boolean;
  onProgress?: (progress: FileTransferProgress) => void;
  onComplete?: (transferId: string) => void;
  onError?: (transferId: string, error: string) => void;
}

export class FileSender {
  private callbacks: FileSenderCallbacks;
  private isCancelled = false;

  constructor(callbacks: FileSenderCallbacks) {
    this.callbacks = callbacks;
  }

  public cancel(): void {
    this.isCancelled = true;
  }

  public async sendFile(
    file: File | { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
    options?: { autoPaste?: boolean }
  ): Promise<string> {
    this.isCancelled = false;
    const sanitizedName = sanitizeFileName(file.name);
    const transferId = safeRandomUUID();
    const arrayBuf = await file.arrayBuffer();
    const totalBytes = arrayBuf.byteLength;
    const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE) || 1;

    // Calculate full file SHA-256
    const fileHash = await sha256(arrayBuf);

    // Send metadata packet
    const metaPacket: FileMetadataPacket = {
      kind: "file-metadata",
      transferId,
      fileName: sanitizedName,
      fileSize: totalBytes,
      fileType: "application/octet-stream",
      totalChunks,
      sha256: fileHash,
      ...(options?.autoPaste ? { autoPaste: true } : {}),
    };

    if (!this.callbacks.sendPacket(metaPacket)) {
      throw new Error("Failed to send file metadata packet");
    }

    const startTime = performance.now();
    let transferredBytes = 0;
    const usingRelay = this.callbacks.isRelayTransport?.() ?? false;
    const maxBuffered = usingRelay ? 32 * 1024 : MAX_BUFFERED_AMOUNT;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (this.isCancelled) {
        const abortPacket: FileAbortPacket = {
          kind: "file-abort",
          transferId,
          reason: "Cancelled by user",
        };
        this.callbacks.sendPacket(abortPacket);
        throw new Error("Transfer cancelled");
      }

      // Check backpressure with timeout guard so stalled relay/DataChannel fails loudly
      let waitCycles = 0;
      while (this.callbacks.getBufferedAmount() > maxBuffered && !this.isCancelled) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (++waitCycles > 1500) {
          throw new Error("Transfer timed out waiting for channel buffer to drain");
        }
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const chunkBuffer = arrayBuf.slice(start, end);
      const dataBase64 = arrayBufferToBase64(chunkBuffer);

      const chunkPacket: FileChunkPacket = {
        kind: "file-chunk",
        transferId,
        chunkIndex,
        totalChunks,
        dataBase64,
      };

      if (!this.callbacks.sendPacket(chunkPacket)) {
        throw new Error(`Failed to transmit chunk ${chunkIndex}`);
      }

      // Smoothly pace Cloud WSS MQTT relay chunks so public brokers don't rate-limit multi-MB .exe/.msi apps
      if (usingRelay && chunkIndex < totalChunks - 1) {
        await new Promise((resolve) => setTimeout(resolve, 8));
      }

      transferredBytes += chunkBuffer.byteLength;
      const elapsedSec = (performance.now() - startTime) / 1000;
      const speedMBps = elapsedSec > 0 ? transferredBytes / (1024 * 1024) / elapsedSec : 0;
      const remainingBytes = totalBytes - transferredBytes;
      const etaSeconds = speedMBps > 0 ? Math.round(remainingBytes / (speedMBps * 1024 * 1024)) : 0;

      this.callbacks.onProgress?.({
        transferId,
        fileName: sanitizedName,
        fileSize: totalBytes,
        transferredBytes,
        totalChunks,
        currentChunk: chunkIndex + 1,
        progressPercent: Math.round((transferredBytes / totalBytes) * 100),
        speedMBps: Math.round(speedMBps * 10) / 10,
        etaSeconds,
        status: "transferring",
      });
    }

    this.callbacks.onProgress?.({
      transferId,
      fileName: sanitizedName,
      fileSize: totalBytes,
      transferredBytes: totalBytes,
      totalChunks,
      currentChunk: totalChunks,
      progressPercent: 100,
      speedMBps: 0,
      etaSeconds: 0,
      status: "completed",
    });

    this.callbacks.onComplete?.(transferId);
    return transferId;
  }
}

export interface FileReceiverCallbacks {
  onProgress?: (progress: FileTransferProgress) => void;
  onFileReceived?: (file: { name: string; blob: Blob; size: number; sha256: string; autoPaste?: boolean }) => void;
  onError?: (transferId: string, error: string) => void;
  sendPacket?: (packet: TransferChannelPacket) => boolean;
}

interface ReceiveTransferState {
  meta: FileMetadataPacket;
  chunks: Map<number, Uint8Array>;
  receivedBytes: number;
  startTime: number;
  finalizing?: boolean;
}

export class FileReceiver {
  private callbacks: FileReceiverCallbacks;
  private transfers = new Map<string, ReceiveTransferState>();

  constructor(callbacks: FileReceiverCallbacks) {
    this.callbacks = callbacks;
  }

  public async handlePacket(packet: TransferChannelPacket): Promise<void> {
    switch (packet.kind) {
      case "file-metadata": {
        this.transfers.set(packet.transferId, {
          meta: packet,
          chunks: new Map<number, Uint8Array>(),
          receivedBytes: 0,
          startTime: performance.now(),
        });

        this.callbacks.onProgress?.({
          transferId: packet.transferId,
          fileName: packet.fileName,
          fileSize: packet.fileSize,
          transferredBytes: 0,
          totalChunks: packet.totalChunks,
          currentChunk: 0,
          progressPercent: 0,
          speedMBps: 0,
          etaSeconds: 0,
          status: "transferring",
        });
        break;
      }

      case "file-chunk": {
        const state = this.transfers.get(packet.transferId);
        if (!state || state.finalizing) {
          return;
        }
        if (state.chunks.has(packet.chunkIndex)) {
          return;
        }

        const chunkBuf = base64ToArrayBuffer(packet.dataBase64);
        const chunkBytes = new Uint8Array(chunkBuf);
        state.chunks.set(packet.chunkIndex, chunkBytes);
        state.receivedBytes += chunkBytes.byteLength;

        const elapsedSec = (performance.now() - state.startTime) / 1000;
        const speedMBps = elapsedSec > 0 ? state.receivedBytes / (1024 * 1024) / elapsedSec : 0;
        const remainingBytes = Math.max(0, state.meta.fileSize - state.receivedBytes);
        const etaSeconds = speedMBps > 0 ? Math.round(remainingBytes / (speedMBps * 1024 * 1024)) : 0;
        const progressPercent =
          state.meta.fileSize > 0
            ? Math.min(100, Math.round((state.receivedBytes / state.meta.fileSize) * 100))
            : 100;

        this.callbacks.onProgress?.({
          transferId: packet.transferId,
          fileName: state.meta.fileName,
          fileSize: state.meta.fileSize,
          transferredBytes: state.receivedBytes,
          totalChunks: state.meta.totalChunks,
          currentChunk: state.chunks.size,
          progressPercent,
          speedMBps: Math.round(speedMBps * 10) / 10,
          etaSeconds,
          status: "transferring",
        });

        // Check if all chunks received
        if (state.chunks.size === state.meta.totalChunks) {
          state.finalizing = true;
          await this.finalizeFileTransfer(state);
        }
        break;
      }

      case "file-abort": {
        if (this.transfers.has(packet.transferId)) {
          this.callbacks.onError?.(packet.transferId, packet.reason);
          this.transfers.delete(packet.transferId);
        }
        break;
      }

      default:
        break;
    }
  }

  private async finalizeFileTransfer(state: ReceiveTransferState): Promise<void> {
    const { meta, chunks, receivedBytes } = state;
    this.callbacks.onProgress?.({
      transferId: meta.transferId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      transferredBytes: receivedBytes,
      totalChunks: meta.totalChunks,
      currentChunk: meta.totalChunks,
      progressPercent: 100,
      speedMBps: 0,
      etaSeconds: 0,
      status: "verifying",
    });

    // Assemble file bytes
    const fullBuffer = new Uint8Array(meta.fileSize);
    let offset = 0;
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunk = chunks.get(i);
      if (!chunk) {
        this.callbacks.onError?.(meta.transferId, `Missing chunk ${i}`);
        this.transfers.delete(meta.transferId);
        return;
      }
      fullBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // Verify SHA-256
    const calculatedHash = await sha256(fullBuffer);
    const verified = calculatedHash === meta.sha256;

    if (!verified) {
      const err = `SHA-256 checksum mismatch: expected ${meta.sha256}, got ${calculatedHash}`;
      this.callbacks.onError?.(meta.transferId, err);
      const completePacket: FileCompletePacket = {
        kind: "file-complete",
        transferId: meta.transferId,
        verified: false,
      };
      this.callbacks.sendPacket?.(completePacket);
      this.transfers.delete(meta.transferId);
      return;
    }

    const blob = new Blob([fullBuffer], { type: meta.fileType });
    this.callbacks.onFileReceived?.({
      name: meta.fileName,
      blob,
      size: meta.fileSize,
      sha256: calculatedHash,
      ...(meta.autoPaste ? { autoPaste: true } : {}),
    });

    const completePacket: FileCompletePacket = {
      kind: "file-complete",
      transferId: meta.transferId,
      verified: true,
    };
    this.callbacks.sendPacket?.(completePacket);

    this.callbacks.onProgress?.({
      transferId: meta.transferId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      transferredBytes: meta.fileSize,
      totalChunks: meta.totalChunks,
      currentChunk: meta.totalChunks,
      progressPercent: 100,
      speedMBps: 0,
      etaSeconds: 0,
      status: "completed",
    });

    this.transfers.delete(meta.transferId);
  }
}
