import { sha256 } from "./crypto";
import type {
  FileMetadataPacket,
  FileChunkPacket,
  FileAckPacket,
  FileCompletePacket,
  FileAbortPacket,
  TransferChannelPacket,
} from "../shared/protocol";

export const CHUNK_SIZE = 64 * 1024; // 64 KB
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

export function sanitizeFileName(rawName: string): string {
  // Strip path separators, null bytes, and traversal attempts
  const clean = rawName
    .replace(/[\0\r\n]/g, "")
    .replace(/^.*[\\\/]/, "") // basename
    .replace(/\.\.+[\\\/]/g, "")
    .trim();

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

  public async sendFile(file: File | { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<string> {
    this.isCancelled = false;
    const sanitizedName = sanitizeFileName(file.name);
    const transferId = crypto.randomUUID();
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
    };

    if (!this.callbacks.sendPacket(metaPacket)) {
      throw new Error("Failed to send file metadata packet");
    }

    const startTime = performance.now();
    let transferredBytes = 0;

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

      // Check backpressure
      while (this.callbacks.getBufferedAmount() > MAX_BUFFERED_AMOUNT) {
        await new Promise((resolve) => setTimeout(resolve, 20));
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
  onFileReceived?: (file: { name: string; blob: Blob; size: number; sha256: string }) => void;
  onError?: (transferId: string, error: string) => void;
  sendPacket?: (packet: TransferChannelPacket) => boolean;
}

export class FileReceiver {
  private callbacks: FileReceiverCallbacks;
  private currentMetadata: FileMetadataPacket | null = null;
  private receivedChunks = new Map<number, Uint8Array>();
  private receivedBytes = 0;
  private startTime = 0;

  constructor(callbacks: FileReceiverCallbacks) {
    this.callbacks = callbacks;
  }

  public async handlePacket(packet: TransferChannelPacket): Promise<void> {
    switch (packet.kind) {
      case "file-metadata": {
        this.currentMetadata = packet;
        this.receivedChunks.clear();
        this.receivedBytes = 0;
        this.startTime = performance.now();

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
        if (!this.currentMetadata || this.currentMetadata.transferId !== packet.transferId) {
          return;
        }

        const chunkBuf = base64ToArrayBuffer(packet.dataBase64);
        const chunkBytes = new Uint8Array(chunkBuf);
        this.receivedChunks.set(packet.chunkIndex, chunkBytes);
        this.receivedBytes += chunkBytes.byteLength;

        const elapsedSec = (performance.now() - this.startTime) / 1000;
        const speedMBps = elapsedSec > 0 ? this.receivedBytes / (1024 * 1024) / elapsedSec : 0;
        const remainingBytes = this.currentMetadata.fileSize - this.receivedBytes;
        const etaSeconds = speedMBps > 0 ? Math.round(remainingBytes / (speedMBps * 1024 * 1024)) : 0;

        this.callbacks.onProgress?.({
          transferId: packet.transferId,
          fileName: this.currentMetadata.fileName,
          fileSize: this.currentMetadata.fileSize,
          transferredBytes: this.receivedBytes,
          totalChunks: this.currentMetadata.totalChunks,
          currentChunk: this.receivedChunks.size,
          progressPercent: Math.round((this.receivedBytes / this.currentMetadata.fileSize) * 100),
          speedMBps: Math.round(speedMBps * 10) / 10,
          etaSeconds,
          status: "transferring",
        });

        // Check if all chunks received
        if (this.receivedChunks.size === this.currentMetadata.totalChunks) {
          await this.finalizeFileTransfer();
        }
        break;
      }

      case "file-abort": {
        if (this.currentMetadata?.transferId === packet.transferId) {
          this.callbacks.onError?.(packet.transferId, packet.reason);
          this.reset();
        }
        break;
      }

      default:
        break;
    }
  }

  private async finalizeFileTransfer(): Promise<void> {
    if (!this.currentMetadata) return;

    const meta = this.currentMetadata;
    this.callbacks.onProgress?.({
      transferId: meta.transferId,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      transferredBytes: this.receivedBytes,
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
      const chunk = this.receivedChunks.get(i);
      if (!chunk) {
        this.callbacks.onError?.(meta.transferId, `Missing chunk ${i}`);
        this.reset();
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
      this.reset();
      return;
    }

    const blob = new Blob([fullBuffer], { type: meta.fileType });
    this.callbacks.onFileReceived?.({
      name: meta.fileName,
      blob,
      size: meta.fileSize,
      sha256: calculatedHash,
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

    this.reset();
  }

  private reset(): void {
    this.currentMetadata = null;
    this.receivedChunks.clear();
    this.receivedBytes = 0;
    this.startTime = 0;
  }
}
