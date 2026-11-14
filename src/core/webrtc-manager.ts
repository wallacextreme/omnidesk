import {
  parseControlPacket,
  parseTransferPacket,
  type ControlChannelPacket,
  type StreamQualityPreset,
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
  onLocalStreamEnded?: () => void;
  onControlChannelStateChange?: (open: boolean) => void;
  onTelemetry?: (stats: TelemetryStats) => void;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun.cloudflare.com:3478",
      "stun:stun.relay.metered.ca:80",
    ],
  },
];

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: DEFAULT_ICE_SERVERS,
  iceCandidatePoolSize: 2,
};

/**
 * Returns WebRTC RTCConfiguration, optionally prepending user-configured TURN/ICE
 * servers stored in localStorage ("omnidesk_ice_servers") without dead public TURN URLs.
 */
export function getEffectiveRtcConfig(): RTCConfiguration {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem("omnidesk_ice_servers");
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const customList = Array.isArray(parsed) ? parsed : [parsed];
        const validCustom: RTCIceServer[] = [];
        for (const item of customList) {
          if (item && typeof item === "object" && "urls" in item) {
            const candidate = item as RTCIceServer;
            if (
              typeof candidate.urls === "string" ||
              (Array.isArray(candidate.urls) && candidate.urls.length > 0)
            ) {
              validCustom.push(candidate);
            }
          }
        }
        if (validCustom.length > 0) {
          return {
            iceServers: [...validCustom, ...DEFAULT_ICE_SERVERS],
            iceCandidatePoolSize: 2,
          };
        }
      }
    }
  } catch (err) {
    console.warn("[WebRTCManager] Ignoring invalid omnidesk_ice_servers config:", err);
  }
  return RTC_CONFIG;
}

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
  private role: "host" | "client" | null = null;
  private isInitializing = false;
  private makingOffer = false;
  private epoch = 0;
  private signalQueue: Promise<void> = Promise.resolve();
  private qualityPreset: StreamQualityPreset = "balanced";

  public setQualityPreset(preset: StreamQualityPreset): void {
    this.qualityPreset = preset;
    void this.applyVideoSenderParameters();
  }

  private getQualityConstraints(): {
    maxBitrate: number;
    maxFramerate: number;
    startBitrateKbps: number;
    minBitrateKbps: number;
    maxBitrateKbps: number;
  } {
    if (this.qualityPreset === "performance") {
      return {
        maxBitrate: 1_800_000,
        maxFramerate: 30,
        startBitrateKbps: 1200,
        minBitrateKbps: 400,
        maxBitrateKbps: 1800,
      };
    }
    if (this.qualityPreset === "original") {
      return {
        maxBitrate: 12_000_000,
        maxFramerate: 60,
        startBitrateKbps: 6000,
        minBitrateKbps: 1500,
        maxBitrateKbps: 12000,
      };
    }
    return {
      maxBitrate: 8_000_000,
      maxFramerate: 60,
      startBitrateKbps: 4000,
      minBitrateKbps: 1000,
      maxBitrateKbps: 8000,
    };
  }

  public async applyVideoSenderParameters(): Promise<void> {
    if (!this.pc) return;
    const { maxBitrate, maxFramerate } = this.getQualityConstraints();
    const senders = this.pc.getSenders();
    for (const sender of senders) {
      if (sender.track?.kind !== "video") continue;
      if ("contentHint" in sender.track) {
        sender.track.contentHint = "detail";
      }
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        const firstEncoding = params.encodings[0];
        if (firstEncoding) {
          firstEncoding.maxBitrate = maxBitrate;
          firstEncoding.maxFramerate = maxFramerate;
        }
        params.degradationPreference = "maintain-resolution";
        await sender.setParameters(params);
      } catch {
        // Fallback if browser rejects degradationPreference
        try {
          const fallbackParams = sender.getParameters();
          if (!fallbackParams.encodings || fallbackParams.encodings.length === 0) {
            fallbackParams.encodings = [{}];
          }
          const enc = fallbackParams.encodings[0];
          if (enc) {
            enc.maxBitrate = maxBitrate;
          }
          await sender.setParameters(fallbackParams);
        } catch {
          // Ignore unsupported runtime parameter changes
        }
      }
    }
  }

  private enhanceVideoSdpBitrate(sdp: string): string {
    const { startBitrateKbps, minBitrateKbps, maxBitrateKbps } = this.getQualityConstraints();
    const lines = sdp.split("\r\n");
    const out: string[] = [];
    let inVideoSection = false;
    let videoPayloads = new Set<string>();
    let addedBandwidthInSection = false;

    for (const line of lines) {
      if (line.startsWith("m=")) {
        inVideoSection = line.startsWith("m=video ");
        addedBandwidthInSection = false;
        if (inVideoSection) {
          const parts = line.trim().split(/\s+/);
          videoPayloads = new Set(parts.slice(3));
        }
        out.push(line);
        continue;
      }

      if (inVideoSection && line.startsWith("b=AS:")) {
        addedBandwidthInSection = true;
        out.push(`b=AS:${maxBitrateKbps}`);
        continue;
      }

      if (inVideoSection && line.startsWith("c=IN ") && !addedBandwidthInSection) {
        out.push(line);
        out.push(`b=AS:${maxBitrateKbps}`);
        addedBandwidthInSection = true;
        continue;
      }

      if (inVideoSection && line.startsWith("a=fmtp:")) {
        const match = /^a=fmtp:(\d+)\s*(.*)$/.exec(line);
        if (match) {
          const pt = match[1] ?? "";
          const params = match[2] ?? "";
          if (videoPayloads.has(pt) && !params.includes("apt=") && !params.includes("x-google-start-bitrate")) {
            const extra = `x-google-min-bitrate=${minBitrateKbps};x-google-start-bitrate=${startBitrateKbps};x-google-max-bitrate=${maxBitrateKbps}`;
            out.push(params ? `a=fmtp:${pt} ${params};${extra}` : `a=fmtp:${pt} ${extra}`);
            continue;
          }
        }
      }
      out.push(line);
    }
    return out.join("\r\n");
  }

  constructor(callbacks: WebRTCManagerCallbacks) {
    this.callbacks = callbacks;
  }

  public getRole(): "host" | "client" | null {
    return this.role;
  }

  public hasOpenControlChannel(): boolean {
    return Boolean(this.controlChannel && this.controlChannel.readyState === "open");
  }

  public getConnectionState(): RTCPeerConnectionState | "closed" {
    return this.pc ? this.pc.connectionState : "closed";
  }

  public async initializeAsHost(providedStream?: MediaStream): Promise<void> {
    this.close();
    const currentEpoch = this.epoch;
    this.role = "host";
    this.isInitializing = true;

    try {
      this.pc = new RTCPeerConnection(getEffectiveRtcConfig());
      this.setupPeerConnectionEvents();

      // Reliable ordered DataChannel for control so key-up (Alt/Ctrl/Shift) and mouse-down/up never drop silently
      this.controlChannel = this.pc.createDataChannel("control-channel", {
        ordered: true,
      });
      this.setupControlChannel(this.controlChannel);

      this.transferChannel = this.pc.createDataChannel("transfer-channel", {
        ordered: true,
      });
      this.setupTransferChannel(this.transferChannel);

      const stream = providedStream || (await nativeBridge.captureScreen());
      if (this.epoch !== currentEpoch || !this.pc) {
        if (!providedStream) {
          for (const t of stream.getTracks()) {
            try {
              t.stop();
            } catch {}
          }
        }
        return;
      }

      this.attachLocalStreamTracks(stream, currentEpoch, false);
      this.prioritizeLightweightCodecs();

      await this.negotiateAsHost();
      if (this.epoch === currentEpoch) {
        this.startTelemetryPolling();
      }
    } catch (err) {
      console.error("[WebRTCManager] Failed to initialize host WebRTC:", err);
      this.close();
      throw err;
    } finally {
      if (this.epoch === currentEpoch) {
        this.isInitializing = false;
      }
    }
  }

  public addLocalStream(stream: MediaStream): void {
    const currentEpoch = this.epoch;
    const needsRenegotiation = this.attachLocalStreamTracks(stream, currentEpoch, true);
    if (this.pc) {
      this.prioritizeLightweightCodecs();
      if (
        needsRenegotiation &&
        this.role === "host" &&
        !this.isInitializing &&
        this.pc.signalingState === "stable"
      ) {
        void this.negotiateAsHost();
      }
    }
  }

  public async replaceLocalStream(stream: MediaStream): Promise<void> {
    const previousStream = this.localStream;
    if (previousStream && previousStream !== stream) {
      for (const oldTrack of previousStream.getTracks()) {
        oldTrack.onended = null;
      }
    }

    const currentEpoch = this.epoch;
    if (!this.pc) {
      this.localStream = stream;
      return;
    }

    const newTracks = stream.getTracks();
    let needsRenegotiation = false;

    for (const track of newTracks) {
      const sender = this.pc
        .getSenders()
        .find((s) => s.track?.kind === track.kind || (s.track === null && track.kind === "video"));
      if (sender && typeof sender.replaceTrack === "function") {
        await sender.replaceTrack(track);
      } else {
        this.pc.addTrack(track, stream);
        needsRenegotiation = true;
      }
      track.onended = () => {
        if (this.localStream === stream && this.epoch === currentEpoch) {
          console.info("[WebRTCManager] Local screen track ended by user");
          this.callbacks.onLocalStreamEnded?.();
        }
      };
    }

    this.localStream = stream;
    this.prioritizeLightweightCodecs();

    if (previousStream && previousStream !== stream) {
      for (const oldTrack of previousStream.getTracks()) {
        if (!newTracks.includes(oldTrack)) {
          try {
            oldTrack.stop();
          } catch {}
        }
      }
    }

    if (
      needsRenegotiation &&
      this.role === "host" &&
      !this.isInitializing &&
      this.pc.signalingState === "stable"
    ) {
      await this.negotiateAsHost();
    }
  }

  private attachLocalStreamTracks(
    stream: MediaStream,
    currentEpoch: number,
    allowReplace: boolean
  ): boolean {
    if (this.localStream && this.localStream !== stream) {
      for (const oldTrack of this.localStream.getTracks()) {
        oldTrack.onended = null;
      }
    }
    this.localStream = stream;
    if (!this.pc) return false;

    let addedNewTrack = false;
    for (const track of stream.getTracks()) {
      try {
        if (allowReplace) {
          const sender = this.pc.getSenders().find((s) => s.track?.kind === track.kind);
          if (sender && typeof sender.replaceTrack === "function") {
            void sender.replaceTrack(track);
          } else {
            this.pc.addTrack(track, stream);
            addedNewTrack = true;
          }
        } else {
          this.pc.addTrack(track, stream);
          addedNewTrack = true;
        }
        track.onended = () => {
          if (this.localStream === stream && this.epoch === currentEpoch) {
            console.info("[WebRTCManager] Local screen track ended by user");
            this.callbacks.onLocalStreamEnded?.();
          }
        };
      } catch (err) {
        console.warn("[WebRTCManager] Error attaching track to PC:", err);
      }
    }
    return addedNewTrack;
  }

  private async negotiateAsHost(): Promise<void> {
    if (!this.pc || this.role !== "host" || this.makingOffer) return;
    if (this.pc.signalingState !== "stable") return;

    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer();
      if (offer.sdp) {
        offer.sdp = this.enhanceVideoSdpBitrate(offer.sdp);
      }
      await this.pc.setLocalDescription(offer);
      if (offer.sdp) {
        this.callbacks.onSignal({
          kind: "offer",
          sdp: offer.sdp,
        });
      }
    } catch (err) {
      console.warn("[WebRTCManager] negotiateAsHost error:", err);
    } finally {
      this.makingOffer = false;
    }
  }

  public async initializeAsClient(): Promise<void> {
    this.close();
    this.role = "client";
    this.pc = new RTCPeerConnection(getEffectiveRtcConfig());
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
    const targetEpoch = this.epoch;
    this.signalQueue = this.signalQueue
      .then(async () => {
        if (!this.pc || this.epoch !== targetEpoch) {
          return;
        }

        switch (payload.kind) {
          case "offer": {
            if (this.pc.signalingState !== "stable") {
              if (this.role === "client") {
                try {
                  await this.pc.setLocalDescription({ type: "rollback" });
                } catch {}
              } else {
                // Host owns negotiation; ignore glare offers from peers when mid-offer
                return;
              }
            }
            await this.pc.setRemoteDescription(
              new RTCSessionDescription({ type: "offer", sdp: payload.sdp })
            );
            await this.drainPendingIceCandidates();
            const answer = await this.pc.createAnswer();
            if (answer.sdp && this.role === "host") {
              answer.sdp = this.enhanceVideoSdpBitrate(answer.sdp);
            }
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
            if (this.pc.signalingState !== "have-local-offer") {
              console.warn(
                "[WebRTCManager] Ignoring unexpected answer in state:",
                this.pc.signalingState
              );
              return;
            }
            await this.pc.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: payload.sdp })
            );
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
            void _exhaustive;
          }
        }
      })
      .catch((err) => {
        console.warn("[WebRTCManager] handleRemoteSignal error:", err);
      });

    return this.signalQueue;
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

  public hasOpenTransferChannel(): boolean {
    return this.transferChannel?.readyState === "open";
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
    this.epoch++;
    this.role = null;
    this.isInitializing = false;
    this.makingOffer = false;
    this.signalQueue = Promise.resolve();
    this.stopTelemetryPolling();

    if (this.controlChannel) {
      this.controlChannel.onopen = null;
      this.controlChannel.onclose = null;
      this.controlChannel.onerror = null;
      this.controlChannel.close();
      this.controlChannel = null;
    }
    this.callbacks.onControlChannelStateChange?.(false);

    if (this.transferChannel) {
      this.transferChannel.close();
      this.transferChannel = null;
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        try {
          track.onended = null;
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
    void this.applyVideoSenderParameters();
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
        if (!this.pc || this.role !== "host" || this.isInitializing || this.makingOffer) {
          return;
        }
        await this.negotiateAsHost();
      } catch (err) {
        console.warn("[WebRTCManager] onnegotiationneeded error:", err);
      }
    };
  }

  private setupControlChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.callbacks.onControlChannelStateChange?.(true);
    };
    channel.onclose = () => {
      this.callbacks.onControlChannelStateChange?.(false);
    };
    channel.onerror = () => {
      this.callbacks.onControlChannelStateChange?.(false);
    };
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
        let inboundFps = 0;
        let outboundFps = 0;
        let bytesReceived = 0;
        let bytesSent = 0;
        let hasInboundVideo = false;
        let packetsLost = 0;
        let totalPackets = 0;

        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            if (typeof report.currentRoundTripTime === "number") {
              rttMs = Math.round(report.currentRoundTripTime * 1000);
            }
          }
          if (report.type === "inbound-rtp" && report.kind === "video") {
            hasInboundVideo = true;
            if (typeof report.framesPerSecond === "number") {
              inboundFps = Math.round(report.framesPerSecond);
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
          if (report.type === "outbound-rtp" && report.kind === "video") {
            if (typeof report.framesPerSecond === "number") {
              outboundFps = Math.round(report.framesPerSecond);
            }
            if (typeof report.bytesSent === "number") {
              bytesSent += report.bytesSent;
            }
          }
        });

        const fps = hasInboundVideo ? inboundFps : outboundFps;
        const bytesTransferred = hasInboundVideo ? bytesReceived : bytesSent;

        const now = Date.now();
        let bitrateKbps = 0;
        if (this.lastStatsTimestamp > 0 && bytesTransferred > this.lastBytesReceived) {
          const durationSec = (now - this.lastStatsTimestamp) / 1000;
          const bits = (bytesTransferred - this.lastBytesReceived) * 8;
          bitrateKbps = Math.round(bits / durationSec / 1000);
        }

        this.lastBytesReceived = bytesTransferred;
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
