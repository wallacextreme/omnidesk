import {
  parseControlPacket,
  parseTransferPacket,
  type ControlChannelPacket,
  type TransferChannelPacket,
  type WebRTCSignalPayload,
  type RTCIceCandidateInitLike,
} from "../shared/protocol";
import { nativeBridge } from "./native-bridge";

export interface TelemetryStats {
  rttMs: number;
  fps: number;
  bitrateKbps: number;
  packetLossPercent: number;
}

export interface WebRTCManagerCallbacks {
  onSignal: (signal: WebRTCSignalPayload) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onControlPacket?: (packet: ControlChannelPacket) => void;
  onTransferPacket?: (packet: TransferChannelPacket) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onTelemetry?: (stats: TelemetryStats) => void;
}

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun.cloudflare.com:3478",
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 4,
};

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private transferChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private fallbackRemoteStream: MediaStream | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private callbacks: WebRTCManagerCallbacks;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private lastBytesReceived = 0;
  private lastStatsTimestamp = 0;

  constructor(callbacks: WebRTCManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public async initializeAsHost(providedStream?: MediaStream): Promise<void> {
    this.close();
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.setupPeerConnectionEvents();

    // Create Data Channels
    this.controlChannel = this.pc.createDataChannel("control-channel", {
      ordered: false,
      maxRetransmits: 0,
    });
    this.setupControlChannel(this.controlChannel);

    this.transferChannel = this.pc.createDataChannel("transfer-channel", {
      ordered: true,
    });
    this.setupTransferChannel(this.transferChannel);

    // Capture or attach screen track
    try {
      this.localStream = providedStream || (await nativeBridge.captureScreen());
      for (const track of this.localStream.getTracks()) {
        this.pc.addTrack(track, this.localStream);
        track.onended = () => {
          console.info("[WebRTCManager] Local screen track ended by user");
          this.callbacks.onConnectionStateChange?.("closed");
        };
      }
      this.prioritizeLightweightCodecs();
    } catch (err) {
      console.error("[WebRTCManager] Failed to attach screen for host:", err);
      this.close();
      throw err;
    }

    // Create offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    if (offer.sdp) {
      this.callbacks.onSignal({
        kind: "offer",
        sdp: offer.sdp,
      });
    }

    this.startTelemetryPolling();
  }

  public addLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    if (this.pc) {
      for (const track of stream.getTracks()) {
        try {
          this.pc.addTrack(track, stream);
          track.onended = () => {
            console.info("[WebRTCManager] Local screen track ended by user");
            this.callbacks.onConnectionStateChange?.("closed");
          };
        } catch (err) {
          console.warn("[WebRTCManager] Error adding track to PC:", err);
        }
      }
      this.prioritizeLightweightCodecs();
    }
  }

  public async initializeAsClient(): Promise<void> {
    this.close();
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.setupPeerConnectionEvents();

    // Explicitly add recvonly video transceiver so SDP offer/answer negotiates incoming host video stream
    try {
      if (typeof this.pc.addTransceiver === "function") {
        this.pc.addTransceiver("video", { direction: "recvonly" });
      }
    } catch (err) {
      console.warn("[WebRTCManager] addTransceiver video recvonly fallback:", err);
    }

    // Client receives data channels created by host
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "control-channel") {
        this.controlChannel = channel;
        this.setupControlChannel(channel);
      } else if (channel.label === "transfer-channel") {
        this.transferChannel = channel;
        this.setupTransferChannel(channel);
      }
    };

    this.startTelemetryPolling();
  }

  public async handleRemoteSignal(payload: WebRTCSignalPayload): Promise<void> {
    if (!this.pc) {
      console.warn("[WebRTCManager] Received signal before initialization");
      return;
    }

    switch (payload.kind) {
      case "offer": {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: payload.sdp }));
        await this.drainPendingIceCandidates();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        if (answer.sdp) {
          this.callbacks.onSignal({
            kind: "answer",
            sdp: answer.sdp,
          });
        }
        break;
      }

      case "answer": {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: payload.sdp }));
        await this.drainPendingIceCandidates();
        break;
      }

      case "ice-candidate": {
        const init: RTCIceCandidateInit = {
          candidate: payload.candidate.candidate,
        };
        if (payload.candidate.sdpMid !== undefined) {
          init.sdpMid = payload.candidate.sdpMid;
        }
        if (payload.candidate.sdpMLineIndex !== undefined) {
          init.sdpMLineIndex = payload.candidate.sdpMLineIndex;
        }
        if (payload.candidate.usernameFragment !== undefined) {
          init.usernameFragment = payload.candidate.usernameFragment;
        }

        if (!this.pc.remoteDescription) {
          this.pendingIceCandidates.push(init);
        } else {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(init));
          } catch (err) {
            console.warn("[WebRTCManager] Failed to add ICE candidate:", err);
          }
        }
        break;
      }

      default: {
        const _exhaustive: never = payload;
      }
    }
  }

  private async drainPendingIceCandidates(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) return;
    while (this.pendingIceCandidates.length > 0) {
      const candidateInit = this.pendingIceCandidates.shift();
      if (candidateInit) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (err) {
          console.warn("[WebRTCManager] Error adding queued ICE candidate:", err);
        }
      }
    }
  }

  public sendControlPacket(packet: ControlChannelPacket): boolean {
    if (!this.controlChannel || this.controlChannel.readyState !== "open") {
      return false;
    }
    try {
      this.controlChannel.send(JSON.stringify(packet));
      return true;
    } catch (err) {
      console.error("[WebRTCManager] Failed to send control packet:", err);
      return false;
    }
  }

  public sendTransferPacket(packet: TransferChannelPacket): boolean {
    if (!this.transferChannel || this.transferChannel.readyState !== "open") {
      return false;
    }
    try {
      this.transferChannel.send(JSON.stringify(packet));
      return true;
    } catch (err) {
      console.error("[WebRTCManager] Failed to send transfer packet:", err);
      return false;
    }
  }

  public getTransferBufferedAmount(): number {
    return this.transferChannel?.bufferedAmount ?? 0;
  }

  public setTransferBufferedAmountLowThreshold(threshold: number): void {
    if (this.transferChannel) {
      this.transferChannel.bufferedAmountLowThreshold = threshold;
    }
  }

  public onTransferBufferedAmountLow(callback: () => void): void {
    if (this.transferChannel) {
      this.transferChannel.onbufferedamountlow = callback;
    }
  }

  public close(): void {
    this.stopTelemetryPolling();

    if (this.controlChannel) {
      this.controlChannel.close();
      this.controlChannel = null;
    }
    if (this.transferChannel) {
      this.transferChannel.close();
      this.transferChannel = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      this.localStream = null;
    }
    if (this.fallbackRemoteStream) {
      for (const track of this.fallbackRemoteStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      this.fallbackRemoteStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.pendingIceCandidates = [];
  }

  private prioritizeLightweightCodecs(): void {
    if (
      typeof RTCRtpSender !== "undefined" &&
      typeof RTCRtpSender.getCapabilities === "function" &&
      this.pc
    ) {
      try {
        const capabilities = RTCRtpSender.getCapabilities("video");
        if (capabilities && capabilities.codecs) {
          const preferredCodecs = [...capabilities.codecs].sort((a, b) => {
            const mimeA = a.mimeType.toLowerCase();
            const mimeB = b.mimeType.toLowerCase();
            const score = (mime: string) => {
              if (mime.includes("h264")) return 1;
              if (mime.includes("vp8")) return 2;
              if (mime.includes("vp9")) return 3;
              if (mime.includes("av1")) return 4;
              return 5;
            };
            return score(mimeA) - score(mimeB);
          });

          for (const transceiver of this.pc.getTransceivers()) {
            if (
              transceiver.sender.track?.kind === "video" &&
              typeof transceiver.setCodecPreferences === "function"
            ) {
              try {
                transceiver.setCodecPreferences(preferredCodecs);
              } catch (err) {
                console.warn("[WebRTC] setCodecPreferences failed:", err);
              }
            }
          }
        }
      } catch (err) {
        console.warn("[WebRTC] prioritizeLightweightCodecs error:", err);
      }
    }
  }

  private setupPeerConnectionEvents(): void {
    if (!this.pc) return;

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const c = event.candidate;
        this.callbacks.onSignal({
          kind: "ice-candidate",
          candidate: {
            candidate: c.candidate,
            sdpMid: c.sdpMid,
            sdpMLineIndex: c.sdpMLineIndex,
            usernameFragment: c.usernameFragment,
          },
        });
      }
    };

    this.pc.ontrack = (event) => {
      let stream = event.streams && event.streams[0];
      if (!stream) {
        if (!this.fallbackRemoteStream) {
          this.fallbackRemoteStream = new MediaStream();
        }
        this.fallbackRemoteStream.addTrack(event.track);
        stream = this.fallbackRemoteStream;
      }
      this.callbacks.onRemoteStream?.(stream);
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc) {
        this.callbacks.onConnectionStateChange?.(this.pc.connectionState);
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        if (!this.pc) return;
        if (this.pc.signalingState === "stable") {
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          if (offer.sdp) {
            this.callbacks.onSignal({
              kind: "offer",
              sdp: offer.sdp,
            });
          }
        }
      } catch (err) {
        console.warn("[WebRTCManager] onnegotiationneeded error:", err);
      }
    };
  }

  private setupControlChannel(channel: RTCDataChannel): void {
    channel.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        const packet = parseControlPacket(raw);
        if (packet) {
          this.callbacks.onControlPacket?.(packet);
        }
      } catch (err) {
        console.warn("[WebRTCManager] Malformed control packet:", err);
      }
    };
  }

  private setupTransferChannel(channel: RTCDataChannel): void {
    channel.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        const packet = parseTransferPacket(raw);
        if (packet) {
          this.callbacks.onTransferPacket?.(packet);
        }
      } catch (err) {
        console.warn("[WebRTCManager] Malformed transfer packet:", err);
      }
    };
  }

  private startTelemetryPolling(): void {
    this.stopTelemetryPolling();
    this.statsInterval = setInterval(async () => {
      if (!this.pc || this.pc.connectionState !== "connected") return;

      try {
        const stats = await this.pc.getStats();
        let rttMs = 0;
        let fps = 0;
        let bytesReceived = 0;
        let packetsLost = 0;
        let totalPackets = 0;

        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            if (typeof report.currentRoundTripTime === "number") {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
          }
          if (report.type === "inbound-rtp" && report.kind === "video") {
            if (typeof report.framesPerSecond === "number") {
              fps = Math.round(report.framesPerSecond);
            }
            if (typeof report.bytesReceived === "number") {
              bytesReceived = report.bytesReceived;
            }
            if (typeof report.packetsLost === "number") {
              packetsLost = report.packetsLost;
            }
            if (typeof report.packetsReceived === "number") {
              totalPackets = report.packetsReceived + packetsLost;
            }
          }
        });

        const now = Date.now();
        let bitrateKbps = 0;
        if (this.lastStatsTimestamp > 0 && bytesReceived > this.lastBytesReceived) {
          const durationSec = (now - this.lastStatsTimestamp) / 1000;
          const bits = (bytesReceived - this.lastBytesReceived) * 8;
          bitrateKbps = Math.round(bits / durationSec / 1000);
        }

        this.lastBytesReceived = bytesReceived;
        this.lastStatsTimestamp = now;

        const packetLossPercent =
          totalPackets > 0 ? Math.min(100, Math.round((packetsLost / totalPackets) * 100)) : 0;

        this.callbacks.onTelemetry?.({
          rttMs,
          fps,
          bitrateKbps,
          packetLossPercent,
        });
      } catch (err) {
        console.warn("[WebRTCManager] Error polling telemetry stats:", err);
      }
    }, 1000);
  }

  private stopTelemetryPolling(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }
}
