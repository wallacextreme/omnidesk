import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dashboard, type RecentSession } from "./components/Dashboard";
import { IncomingRequestModal } from "./components/IncomingRequestModal";
import { RemoteSessionViewport } from "./components/RemoteSessionViewport";
import { HostActiveSessionBar } from "./components/HostActiveSessionBar";
import { ChatDrawer } from "./components/ChatDrawer";
import { FileTransferDrawer } from "./components/FileTransferDrawer";
import { WebRTCManager, type TelemetryStats } from "./core/webrtc-manager";
import { ACLGuard } from "./core/acl-guard";
import { FileSender, FileReceiver, type FileTransferProgress } from "./core/file-transfer";
import { nativeBridge, type ControlBridgeStatus } from "./core/native-bridge";
import { FrameRelayHost } from "./core/frame-relay";
import {
  generateNonce,
  generateSalt,
  computeAuthProof,
  verifyAuthProof,
  safeRandomUUID,
  isSubtleAvailable,
} from "./core/crypto";
import {
  SignalingClient,
  type SignalingMode,
  type SignalingStatus,
  getOrCreateHostSecret,
} from "./core/signaling-client";
import {
  DEFAULT_ACL_PERMISSIONS,
  normalizeDeviceId,
  formatDeviceId,
  parseSignalingMessage,
  type ACLPermissions,
  type ChatMessagePacket,
  type ControlChannelPacket,
  type InputPacket,
  type SignalingMessage,
  type StreamQualityPreset,
  type TransferChannelPacket,
  type WebRTCSignalPayload,
} from "./shared/protocol";

function triggerBrowserDownload(file: { name: string; blob: Blob }): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  try {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore cleanup errors
      }
    }, 2000);
  } catch {
    // Ignore auto-download failures in constrained environments
  }
}

const FRAME_CHUNK_SIZE = 20_000;
const DIRECT_FRAME_LIMIT = 24_000;

function getInitialSignalingUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:4000";

  try {
    const saved = localStorage.getItem("omnidesk_signaling_url");
    if (saved) return saved;
  } catch {}

  const loc = window.location;
  const isLocalOrLan =
    loc.hostname === "localhost" ||
    loc.hostname === "127.0.0.1" ||
    loc.hostname.startsWith("192.168.") ||
    loc.hostname.startsWith("10.") ||
    loc.hostname.startsWith("172.");

  if (isLocalOrLan) {
    return `ws://${loc.hostname}:4000`;
  }

  return loc.protocol === "https:"
    ? `wss://${loc.hostname}:4000`
    : `ws://${loc.hostname}:4000`;
}

export const App: React.FC = () => {
  const [signalingUrl, setSignalingUrl] = useState<string>(getInitialSignalingUrl);

  const handleUpdateSignalingUrl = useCallback((url: string) => {
    setSignalingUrl(url);
    try {
      localStorage.setItem("omnidesk_signaling_url", url);
    } catch {}
  }, []);

  // Device & Host State (synchronously loaded from storage to maintain ID stability)
  const [deviceId, setDeviceId] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      try {
        return localStorage.getItem("omnidesk_device_id") || localStorage.getItem("pulsedesk_device_id") || "";
      } catch {}
    }
    return "";
  });

  const [deviceName] = useState<string>(() => {
    if (typeof navigator !== "undefined") {
      let saved = "";
      try {
        saved = localStorage.getItem("omnidesk_device_name") || localStorage.getItem("pulsedesk_device_name") || "";
      } catch {}
      if (saved) return saved;
      const gen = `OmniNode-${Math.floor(100 + Math.random() * 900)}`;
      try {
        localStorage.setItem("omnidesk_device_name", gen);
      } catch {}
      return gen;
    }
    return "OmniDesk-Node";
  });

  const [isSignalingOnline, setIsSignalingOnline] = useState<boolean>(false);
  const [unattendedPassword, setUnattendedPassword] = useState<string>("");
  const [defaultAcl, setDefaultAcl] = useState<ACLPermissions>({ ...DEFAULT_ACL_PERMISSIONS });
  const [useSyntheticStream, setUseSyntheticStream] = useState<boolean>(() => {
    return nativeBridge.isForceSyntheticStream();
  });

  // Incoming Connection Request Modal (Host-Side)
  const [incomingRequest, setIncomingRequest] = useState<{
    clientDeviceId: string;
    clientName: string;
    hasUnattendedPassword: boolean;
  } | null>(null);

  // Active Session State: 'idle' = no session; 'host' = broadcasting this screen; 'client' = watching remote screen
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [sessionRole, setSessionRole] = useState<"idle" | "host" | "client">("idle");
  const [remotePeerId, setRemotePeerId] = useState<string>("");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [hostChatOpen, setHostChatOpen] = useState<boolean>(false);
  const [hostFilesOpen, setHostFilesOpen] = useState<boolean>(false);

  // Telemetry & Permissions
  const [telemetry, setTelemetry] = useState<TelemetryStats>({
    rttMs: 0,
    fps: 0,
    bitrateKbps: 0,
    packetLossPercent: 0,
  });
  const [activeAcl, setActiveAcl] = useState<ACLPermissions>({ ...DEFAULT_ACL_PERMISSIONS });
  const [fallbackFrame, setFallbackFrame] = useState<string | null>(null);
  const [fallbackFrameSize, setFallbackFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [relayStats, setRelayStats] = useState<{ fps: number; bitrateKbps: number }>({
    fps: 0,
    bitrateKbps: 0,
  });
  const [hostIsSyntheticStream, setHostIsSyntheticStream] = useState<boolean>(false);
  const [controlBridgeStatus, setControlBridgeStatus] = useState<ControlBridgeStatus>(() =>
    nativeBridge.getControlStatus()
  );
  const [hostNativeControlActive, setHostNativeControlActive] = useState<boolean | null>(null);

  // Chat & File Transfer State
  const [chatMessages, setChatMessages] = useState<ChatMessagePacket[]>([]);
  const [hostReadChatCount, setHostReadChatCount] = useState<number>(0);
  const [activeTransferProgress, setActiveTransferProgress] = useState<FileTransferProgress | null>(null);
  const [receivedFiles, setReceivedFiles] = useState<
    Array<{ name: string; size: number; blob: Blob; sha256: string }>
  >([]);
  const [lastSyncedClipboardText, setLastSyncedClipboardText] = useState<string>("");
  const lastSyncedClipboardTextRef = useRef<string>("");
  const [statusBanner, setStatusBanner] = useState<{
    id: string;
    text: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const statusBannerTimerRef = useRef<number | null>(null);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const hostClipboardFilesMapRef = useRef<
    Map<string, { name: string; size: number; mimeType: string; autoSend: boolean }>
  >(new Map());

  // Recent Sessions History
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>(() => {
    if (typeof localStorage !== "undefined") {
      try {
        const saved = localStorage.getItem("omnidesk_recent_sessions") || localStorage.getItem("pulsedesk_recent_sessions");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });

  // Refs for persistent state without re-triggering effects
  const [signalingMode, setSignalingMode] = useState<SignalingMode>(() => {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem("omnidesk_signaling_mode");
      if (saved === "cloud" || saved === "local") return saved;
    }
    return "cloud";
  });
  const [signalingStatus, setSignalingStatus] = useState<SignalingStatus | null>(null);

  const deviceIdRef = useRef<string>(deviceId);
  const unattendedPasswordRef = useRef<string>(unattendedPassword);
  const defaultAclRef = useRef<ACLPermissions>(defaultAcl);
  const sessionRoleRef = useRef<"idle" | "host" | "client">(sessionRole);
  const remotePeerIdRef = useRef<string>(remotePeerId);
  const activeAclRef = useRef<ACLPermissions>(activeAcl);
  const signalingClientRef = useRef<SignalingClient | null>(null);
  const hostSecretRef = useRef<string>(getOrCreateHostSecret());
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const frameRelayRef = useRef<FrameRelayHost | null>(null);
  const clientReportedWebRtcFreezeRef = useRef<boolean>(false);
  const hostStreamRef = useRef<MediaStream | null>(null);
  const pendingSignalsRef = useRef<WebRTCSignalPayload[]>([]);
  const aclGuardRef = useRef<ACLGuard>(new ACLGuard(DEFAULT_ACL_PERMISSIONS));
  const fileSenderRef = useRef<FileSender | null>(null);
  const fileReceiverRef = useRef<FileReceiver | null>(null);
  const frameSeqRef = useRef<number>(0);
  const latestMouseMoveRef = useRef<{ x: number; y: number } | null>(null);
  const mouseMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMouseMoveSentAtRef = useRef<number>(0);
  const frameChunkBufferRef = useRef<
    Map<
      string,
      {
        total: number;
        parts: (string | undefined)[];
        received: number;
        width: number;
        height: number;
        timestamp: number;
        createdAt: number;
      }
    >
  >(new Map());
  const relayMeterRef = useRef<{
    frames: number;
    bytes: number;
    windowStart: number;
    latestTimestamp: number;
  }>({
    frames: 0,
    bytes: 0,
    windowStart: Date.now(),
    latestTimestamp: 0,
  });
  const handleEndSessionRef = useRef<(notifyPeer?: boolean) => void>(() => {});
  const currentChallengeRef = useRef<{
    nonce: string;
    salt: string;
    clientDeviceId: string;
    iterations?: number;
  } | null>(null);
  const pendingPasswordRef = useRef<string>("");

  // Sync state to refs
  useEffect(() => {
    deviceIdRef.current = deviceId;
  }, [deviceId]);

  useEffect(() => {
    sessionRoleRef.current = sessionRole;
  }, [sessionRole]);

  useEffect(() => {
    remotePeerIdRef.current = remotePeerId;
  }, [remotePeerId]);

  useEffect(() => {
    activeAclRef.current = activeAcl;
  }, [activeAcl]);

  useEffect(() => {
    unattendedPasswordRef.current = unattendedPassword;
    if (signalingClientRef.current && deviceIdRef.current) {
      signalingClientRef.current.send({
        type: "register-host",
        deviceId: deviceIdRef.current,
        deviceName,
        unattendedEnabled: Boolean(unattendedPassword),
        hostSecret: hostSecretRef.current,
      });
    }
  }, [unattendedPassword, deviceName]);

  useEffect(() => {
    defaultAclRef.current = defaultAcl;
  }, [defaultAcl]);

  useEffect(() => {
    if (hostChatOpen) {
      setHostReadChatCount(chatMessages.length);
    }
  }, [hostChatOpen, chatMessages.length]);

  // Discover local Windows Native Agent (127.0.0.1:47831) for OS-level mouse/keyboard control
  useEffect(() => {
    nativeBridge.startAgentDiscovery();
    const unsubscribe = nativeBridge.subscribeControlStatus((status) => {
      setControlBridgeStatus(status);
    });
    return () => {
      unsubscribe();
      nativeBridge.stopAgentDiscovery();
    };
  }, []);

  // Persist recent sessions
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("omnidesk_recent_sessions", JSON.stringify(recentSessions));
    }
  }, [recentSessions]);

  // Send signaling message helper
  const sendSignaling = useCallback((msg: SignalingMessage) => {
    signalingClientRef.current?.send(msg);
  }, []);

  const handleSwitchSignalingMode = useCallback((mode: SignalingMode, customUrl?: string) => {
    setSignalingMode(mode);
    if (customUrl) {
      setSignalingUrl(customUrl);
    }
    signalingClientRef.current?.switchMode(mode, customUrl);
  }, []);

  const recordRelayThroughput = useCallback((byteCount: number, isHostSide: boolean) => {
    const meter = relayMeterRef.current;
    const now = Date.now();
    // Reset stale window if this is the first frame after idle time
    if (meter.frames === 0 || now - meter.windowStart > 3000) {
      meter.frames = 1;
      meter.bytes = byteCount;
      meter.windowStart = now;
      return;
    }
    meter.frames += 1;
    meter.bytes += byteCount;
    const elapsedMs = now - meter.windowStart;
    if (elapsedMs >= 1000) {
      const elapsedSec = elapsedMs / 1000;
      const fps = Math.max(1, Math.round(meter.frames / elapsedSec));
      const bitrateKbps = Math.round((meter.bytes * 8) / elapsedSec / 1000);
      meter.frames = 0;
      meter.bytes = 0;
      meter.windowStart = now;
      setRelayStats({ fps, bitrateKbps });
      if (isHostSide && webrtcRef.current?.getConnectionState() !== "connected") {
        setTelemetry((prev) => ({
          ...prev,
          fps,
          bitrateKbps,
        }));
      }
    }
  }, []);

  const commitCompleteFallbackFrame = useCallback(
    (frameDataUrl: string, width: number, height: number, timestamp: number) => {
      if (timestamp < relayMeterRef.current.latestTimestamp) {
        return; // Drop stale out-of-order frame
      }
      relayMeterRef.current.latestTimestamp = timestamp;
      setFallbackFrame(frameDataUrl);
      setFallbackFrameSize({ width, height });
      recordRelayThroughput(frameDataUrl.length, false);
    },
    [recordRelayThroughput]
  );

  const handleIncomingControlPacket = useCallback((role: "host" | "client", packet: ControlChannelPacket) => {
    if (role === "host") {
      if (packet.kind === "acl-update") {
        aclGuardRef.current.setAll(packet.permissions);
        setActiveAcl(packet.permissions);
        activeAclRef.current = packet.permissions;
        return;
      }

      if (!aclGuardRef.current.canExecuteControlPacket(packet)) {
        return; // Dropped by Zero-Trust ACL Guard
      }

      if (packet.kind === "stream-quality") {
        webrtcRef.current?.setQualityPreset(packet.quality);
        return;
      }

      if (packet.kind === "chat-message") {
        setChatMessages((prev) => [...prev, packet]);
        return;
      }

      if (packet.kind === "release-all") {
        void nativeBridge.releaseAllInputs();
        return;
      }

      if (
        packet.kind.startsWith("mouse-") ||
        packet.kind.startsWith("key-") ||
        packet.kind === "special-key"
      ) {
        if (
          packet.kind === "mouse-down" ||
          packet.kind === "mouse-up" ||
          packet.kind === "mouse-dblclick"
        ) {
          frameRelayRef.current?.skipNextFrame();
        }
        void nativeBridge.injectInput(packet as InputPacket);
      }
    } else {
      if (packet.kind === "acl-update") {
        setActiveAcl(packet.permissions);
        activeAclRef.current = packet.permissions;
      } else if (packet.kind === "chat-message") {
        setChatMessages((prev) => [...prev, packet]);
      }
    }
  }, []);

  const showStatusBanner = useCallback(
    (
      text: string,
      options?: { actionLabel?: string; onAction?: () => void; durationMs?: number }
    ) => {
      if (statusBannerTimerRef.current !== null) {
        window.clearTimeout(statusBannerTimerRef.current);
        statusBannerTimerRef.current = null;
      }
      const next: {
        id: string;
        text: string;
        actionLabel?: string;
        onAction?: () => void;
      } = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text,
      };
      if (options?.actionLabel) next.actionLabel = options.actionLabel;
      if (options?.onAction) next.onAction = options.onAction;
      setStatusBanner(next);

      const durationMs = options?.durationMs ?? 4500;
      if (durationMs > 0) {
        statusBannerTimerRef.current = window.setTimeout(() => {
          statusBannerTimerRef.current = null;
          setStatusBanner(null);
        }, durationMs);
      }
    },
    []
  );

  const sendTransferPacketWithFallback = useCallback(
    (packet: TransferChannelPacket): boolean => {
      const sentViaWebRTC = webrtcRef.current?.sendTransferPacket(packet) ?? false;
      if (sentViaWebRTC) return true;
      if (remotePeerIdRef.current && deviceIdRef.current) {
        sendSignaling({
          type: "transfer-relay",
          targetId: remotePeerIdRef.current,
          senderId: deviceIdRef.current,
          packet,
        });
        return true;
      }
      return false;
    },
    [sendSignaling]
  );

  const handleIncomingTransferPacket = useCallback(
    (role: "host" | "client", packet: TransferChannelPacket) => {
      if (role === "host" && !aclGuardRef.current.canExecuteTransferPacket(packet)) {
        return; // Dropped by ACL Guard
      }

      if (packet.kind === "clipboard-sync") {
        if (role === "client" && !activeAclRef.current.allowClipboard) return;
        if (packet.text === lastSyncedClipboardTextRef.current) return;
        lastSyncedClipboardTextRef.current = packet.text;
        setLastSyncedClipboardText(packet.text);
        void nativeBridge.writeClipboard(packet.text).then((ok) => {
          if (ok) {
            showStatusBanner("Área de transferência sincronizada", { durationMs: 2500 });
          } else {
            showStatusBanner("Texto recebido do dispositivo remoto", {
              actionLabel: "Copiar texto",
              durationMs: 8000,
              onAction: () => {
                void nativeBridge.writeClipboard(packet.text);
                setStatusBanner(null);
              },
            });
          }
        });
        return;
      }

      if (packet.kind === "clipboard-files-ready") {
        if (role === "client" && !activeAclRef.current.allowFileTransfer) return;
        const first = packet.files[0];
        if (!first) return;
        const totalSizeMb = (
          packet.files.reduce((sum, f) => sum + f.size, 0) /
          (1024 * 1024)
        ).toFixed(1);
        const label =
          packet.files.length === 1
            ? `${first.name} (${totalSizeMb} MB)`
            : `${packet.files.length} arquivos no Host (${totalSizeMb} MB)`;
        showStatusBanner(`Pronto para copiar do Host: ${label}`, {
          actionLabel: "Baixar",
          durationMs: 12000,
          onAction: () => {
            for (const f of packet.files) {
              sendTransferPacketWithFallback({
                kind: "clipboard-file-request",
                id: f.id,
              });
            }
            showStatusBanner("Solicitando arquivos ao Host...");
          },
        });
        return;
      }

      if (packet.kind === "clipboard-file-request") {
        if (role !== "host") return;
        const entry = hostClipboardFilesMapRef.current.get(packet.id);
        if (entry) {
          entry.autoSend = true;
        }
        nativeBridge.requestAgentClipboardFile(packet.id);
        return;
      }

      fileReceiverRef.current?.handlePacket(packet);
    },
    [sendTransferPacketWithFallback, showStatusBanner]
  );

  const handleIncomingTransferPacketRef = useRef(handleIncomingTransferPacket);
  handleIncomingTransferPacketRef.current = handleIncomingTransferPacket;

  const dispatchControlPacket = useCallback(
    (packet: ControlChannelPacket) => {
      if (webrtcRef.current?.hasOpenControlChannel()) {
        const sentViaWebRTC = webrtcRef.current.sendControlPacket(packet);
        if (sentViaWebRTC) return;
      }
      if (remotePeerIdRef.current && deviceIdRef.current) {
        sendSignaling({
          type: "control-relay",
          targetId: remotePeerIdRef.current,
          senderId: deviceIdRef.current,
          packet,
        });
      }
    },
    [sendSignaling]
  );

  const clearPendingMouseMove = useCallback(() => {
    if (mouseMoveTimerRef.current !== null) {
      clearTimeout(mouseMoveTimerRef.current);
      mouseMoveTimerRef.current = null;
    }
    latestMouseMoveRef.current = null;
  }, []);

  const sendControlPacketWithFallback = useCallback(
    (packet: ControlChannelPacket) => {
      if (
        packet.kind === "mouse-down" ||
        packet.kind === "mouse-up" ||
        packet.kind === "mouse-dblclick" ||
        packet.kind === "key-down" ||
        packet.kind === "key-up"
      ) {
        clearPendingMouseMove();
        dispatchControlPacket(packet);
        return;
      }

      if (packet.kind === "mouse-move") {
        const isWebRtcOpen = webrtcRef.current?.hasOpenControlChannel() ?? false;
        const intervalMs = isWebRtcOpen ? 16 : 40;
        const now = Date.now();
        const elapsed = now - lastMouseMoveSentAtRef.current;

        if (elapsed >= intervalMs) {
          clearPendingMouseMove();
          lastMouseMoveSentAtRef.current = now;
          dispatchControlPacket(packet);
        } else {
          latestMouseMoveRef.current = { x: packet.x, y: packet.y };
          if (mouseMoveTimerRef.current === null) {
            mouseMoveTimerRef.current = setTimeout(() => {
              mouseMoveTimerRef.current = null;
              const pending = latestMouseMoveRef.current;
              latestMouseMoveRef.current = null;
              if (!pending) return;
              lastMouseMoveSentAtRef.current = Date.now();
              dispatchControlPacket({
                kind: "mouse-move",
                x: pending.x,
                y: pending.y,
              });
            }, Math.max(1, intervalMs - elapsed));
          }
        }
        return;
      }

      dispatchControlPacket(packet);
    },
    [clearPendingMouseMove, dispatchControlPacket]
  );

  // Instant WSS Frame Relay (AnyDesk fallback, auto-chunked for public MQTT reliability)
  const startFrameRelay = useCallback(
    (stream: MediaStream, targetPeerId: string) => {
      frameRelayRef.current?.stop();
      relayMeterRef.current = {
        frames: 0,
        bytes: 0,
        windowStart: Date.now(),
        latestTimestamp: 0,
      };
      const relay = new FrameRelayHost(stream, (dataUrl, w, h) => {
        const now = Date.now();
        recordRelayThroughput(dataUrl.length, true);
        if (dataUrl.length <= DIRECT_FRAME_LIMIT) {
          sendSignaling({
            type: "video-frame",
            targetId: targetPeerId,
            senderId: deviceIdRef.current,
            frameDataUrl: dataUrl,
            width: w,
            height: h,
            timestamp: now,
          });
        } else {
          const frameId = `${now.toString(36)}-${++frameSeqRef.current}`;
          const totalChunks = Math.ceil(dataUrl.length / FRAME_CHUNK_SIZE);
          for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const slice = dataUrl.slice(
              chunkIndex * FRAME_CHUNK_SIZE,
              (chunkIndex + 1) * FRAME_CHUNK_SIZE
            );
            sendSignaling({
              type: "video-frame-chunk",
              targetId: targetPeerId,
              senderId: deviceIdRef.current,
              frameId,
              chunkIndex,
              totalChunks,
              data: slice,
              width: w,
              height: h,
              timestamp: now,
            });
          }
        }
      });
      relay.start(200, 960);
      frameRelayRef.current = relay;
    },
    [sendSignaling, recordRelayThroughput]
  );

  // WebRTC Setup Helper
  const setupWebRTC = useCallback(
    async (role: "host" | "client", targetId: string, providedStream?: MediaStream) => {
      if (webrtcRef.current) {
        webrtcRef.current.close();
        webrtcRef.current = null;
      }

      const myDeviceId = deviceIdRef.current;

      const manager = new WebRTCManager({
        onSignal: (signal) => {
          sendSignaling({
            type: "webrtc-signal",
            targetId,
            senderId: myDeviceId,
            signal,
          });
        },
        onRemoteStream: (stream) => {
          setRemoteStream(stream);
        },
        onTelemetry: (stats) => {
          setTelemetry(stats);
          if (
            role === "host" &&
            !clientReportedWebRtcFreezeRef.current &&
            webrtcRef.current?.getConnectionState() === "connected" &&
            stats.fps >= 2 &&
            stats.bitrateKbps > 20
          ) {
            frameRelayRef.current?.pause();
          }
        },
        onLocalStreamEnded: () => {
          handleEndSessionRef.current(true);
        },
        onConnectionStateChange: (state) => {
          if (state === "failed" || state === "closed") {
            // Keep session active on WSS Frame Relay instead of abruptly closing
            if (role === "client") {
              setRemoteStream(null);
              if (remotePeerIdRef.current) {
                sendSignaling({
                  type: "video-status",
                  targetId: remotePeerIdRef.current,
                  senderId: deviceIdRef.current,
                  webrtcActive: false,
                });
              }
            } else {
              frameRelayRef.current?.resume();
            }
          } else if (state === "disconnected" && role === "host") {
            frameRelayRef.current?.resume();
          } else if (state === "connected" && role === "host" && !clientReportedWebRtcFreezeRef.current) {
            frameRelayRef.current?.pause();
          }
        },
        onControlChannelStateChange: (open) => {
          if (open && role === "host" && !clientReportedWebRtcFreezeRef.current) {
            frameRelayRef.current?.pause();
          }
        },
        onControlPacket: (packet) => {
          handleIncomingControlPacket(role, packet);
        },
        onTransferPacket: (packet) => {
          handleIncomingTransferPacketRef.current(role, packet);
        },
      });

      // File transfer handlers (WebRTC DataChannel with transparent WSS fallback)
      fileSenderRef.current = new FileSender({
        sendPacket: (pkt) => sendTransferPacketWithFallback(pkt),
        getBufferedAmount: () =>
          webrtcRef.current?.hasOpenTransferChannel()
            ? manager.getTransferBufferedAmount()
            : (signalingClientRef.current?.getBufferedAmount() ?? 0),
        isRelayTransport: () => !(webrtcRef.current?.hasOpenTransferChannel() ?? false),
        onProgress: (prog) => setActiveTransferProgress({ ...prog }),
      });

      fileReceiverRef.current = new FileReceiver({
        sendPacket: (pkt) => sendTransferPacketWithFallback(pkt),
        onProgress: (prog) => setActiveTransferProgress({ ...prog }),
        onFileReceived: (file) => {
          setReceivedFiles((prev) => [
            { name: file.name, size: file.size, blob: file.blob, sha256: file.sha256 },
            ...prev,
          ]);
          void (async () => {
            if (nativeBridge.hasNativeOSControl()) {
              try {
                const buf = await file.blob.arrayBuffer();
                const savedOk = await nativeBridge.saveReceivedFileToAgent(
                  file.name,
                  buf,
                  Boolean(file.autoPaste)
                );
                if (savedOk) {
                  showStatusBanner(
                    file.autoPaste
                      ? `Colado no Windows: ${file.name}`
                      : `Salvo em Downloads\\OmniDesk: ${file.name}`
                  );
                  return;
                }
              } catch {
                // Fall back to browser download
              }
            }
            triggerBrowserDownload(file);
            showStatusBanner(`Arquivo recebido: ${file.name}`);
          })();
        },
      });

      if (role === "host") {
        await manager.initializeAsHost(providedStream);
      } else {
        await manager.initializeAsClient();
      }

      webrtcRef.current = manager;

      // Drain any queued signals received before WebRTC initialization completed
      while (pendingSignalsRef.current.length > 0) {
        const pending = pendingSignalsRef.current.shift();
        if (pending) {
          await manager.handleRemoteSignal(pending);
        }
      }

      sessionRoleRef.current = role;
      remotePeerIdRef.current = targetId;
      setSessionRole(role);
      setRemotePeerId(targetId);
      setSessionActive(true);
      setIsConnecting(false);
    },
    [sendSignaling, handleIncomingControlPacket]
  );

  const setupWebRTCRef = useRef(setupWebRTC);
  setupWebRTCRef.current = setupWebRTC;

  // Initialize Signaling Connection ONCE on mount
  useEffect(() => {
    const client = new SignalingClient(
      {
        onStatusChange: (status) => {
          setIsSignalingOnline(status.online);
          setSignalingStatus(status);
        },
        onRegistered: (registeredId) => {
          setDeviceId(registeredId);
          deviceIdRef.current = registeredId;
          try {
            localStorage.setItem("omnidesk_device_id", registeredId);
          } catch {}
        },
        onMessage: async (msg) => {
          try {
            switch (msg.type) {
              case "registered": {
                setDeviceId(msg.deviceId);
                deviceIdRef.current = msg.deviceId;
                try {
                  localStorage.setItem("omnidesk_device_id", msg.deviceId);
                } catch {}
                break;
              }

              case "session-request": {
                // Host receives connection request from client
                if (msg.hasUnattendedPassword && unattendedPasswordRef.current) {
                  // Unattended challenge flow
                  const nonce = generateNonce(32);
                  const salt = generateSalt(16);
                  const iterations = isSubtleAvailable ? 600_000 : 2_000;
                  currentChallengeRef.current = {
                    nonce,
                    salt,
                    clientDeviceId: msg.clientDeviceId,
                    iterations,
                  };
                  sendSignaling({
                    type: "auth-challenge",
                    targetId: msg.clientDeviceId,
                    senderId: deviceIdRef.current,
                    nonce,
                    salt,
                    iterations,
                  });
                } else {
                  // Manual modal prompt
                  setIncomingRequest({
                    clientDeviceId: msg.clientDeviceId,
                    clientName: msg.clientName,
                    hasUnattendedPassword: msg.hasUnattendedPassword,
                  });
                }
                break;
              }

              case "auth-challenge": {
                // Client receives challenge from host
                const pwd = pendingPasswordRef.current;
                if (pwd) {
                  const proof = await computeAuthProof(pwd, msg.salt, msg.nonce, msg.iterations);
                  sendSignaling({
                    type: "auth-response",
                    targetId: msg.senderId,
                    senderId: deviceIdRef.current,
                    proof,
                  });
                } else {
                  sendSignaling({
                    type: "session-rejected",
                    targetId: msg.senderId,
                    reason: "Senha de acesso desassistido requerida mas não fornecida.",
                  });
                }
                break;
              }

              case "auth-response": {
                // Host receives proof from client
                const challenge = currentChallengeRef.current;
                if (challenge && challenge.clientDeviceId === msg.senderId) {
                  const isValid = await verifyAuthProof(
                    unattendedPasswordRef.current,
                    challenge.salt,
                    challenge.nonce,
                    msg.proof,
                    challenge.iterations
                  );

                  if (isValid) {
                    let stream: MediaStream;
                    try {
                      stream = await nativeBridge.captureScreen();
                    } catch (err) {
                      console.warn("[App] Host unattended screen capture failed:", err);
                      sendSignaling({
                        type: "session-rejected",
                        targetId: msg.senderId,
                        senderId: deviceIdRef.current,
                        reason: "Captura de tela cancelada no Host.",
                      });
                      handleEndSessionRef.current(false);
                      currentChallengeRef.current = null;
                      break;
                    }

                    hostStreamRef.current = stream;
                    setHostIsSyntheticStream(nativeBridge.isSyntheticStream(stream));
                    aclGuardRef.current.setAll(defaultAclRef.current);
                    setActiveAcl(defaultAclRef.current);
                    activeAclRef.current = defaultAclRef.current;
                    remotePeerIdRef.current = msg.senderId;
                    sessionRoleRef.current = "host";
                    setRemotePeerId(msg.senderId);
                    setSessionRole("host");
                    setSessionActive(true);
                    setIsConnecting(false);

                    // Notify client accepted ONLY AFTER screen stream is ready
                    sendSignaling({
                      type: "session-accepted",
                      targetId: msg.senderId,
                      senderId: deviceIdRef.current,
                      permissions: defaultAclRef.current,
                    });

                    startFrameRelay(stream, msg.senderId);
                    try {
                      await setupWebRTCRef.current("host", msg.senderId, stream);
                    } catch (rtcErr) {
                      console.warn("[App] WebRTC setup failed in unattended mode, continuing on WSS Relay:", rtcErr);
                    }
                  } else {
                    sendSignaling({
                      type: "session-rejected",
                      targetId: msg.senderId,
                      senderId: deviceIdRef.current,
                      reason: "Senha de acesso desassistido incorreta.",
                    });
                  }
                  currentChallengeRef.current = null;
                }
                break;
              }

              case "session-accepted": {
                // Client receives acceptance from host
                setActiveAcl(msg.permissions);
                activeAclRef.current = msg.permissions;
                aclGuardRef.current.setAll(msg.permissions);
                remotePeerIdRef.current = msg.senderId;
                sessionRoleRef.current = "client";
                setHostNativeControlActive(null);
                setRemotePeerId(msg.senderId);
                setSessionRole("client");
                setSessionActive(true);
                setIsConnecting(false);
                try {
                  await setupWebRTCRef.current("client", msg.senderId);
                } catch (rtcErr) {
                  console.warn("[App] WebRTC client init failed, continuing on WSS Relay:", rtcErr);
                }
                break;
              }

              case "session-rejected": {
                setIsConnecting(false);
                alert(`Conexão recusada: ${msg.reason}`);
                break;
              }

              case "video-frame": {
                commitCompleteFallbackFrame(
                  msg.frameDataUrl,
                  msg.width,
                  msg.height,
                  msg.timestamp
                );
                break;
              }

              case "video-frame-chunk": {
                const nowMs = Date.now();
                const map = frameChunkBufferRef.current;
                if (nowMs % 10 === 0 || map.size > 6) {
                  for (const [fid, entry] of map.entries()) {
                    if (nowMs - entry.createdAt > 5000 || entry.timestamp < relayMeterRef.current.latestTimestamp) {
                      map.delete(fid);
                    }
                  }
                }
                let entry = map.get(msg.frameId);
                if (!entry) {
                  if (msg.timestamp < relayMeterRef.current.latestTimestamp) {
                    break;
                  }
                  entry = {
                    total: msg.totalChunks,
                    parts: new Array<string | undefined>(msg.totalChunks),
                    received: 0,
                    width: msg.width,
                    height: msg.height,
                    timestamp: msg.timestamp,
                    createdAt: nowMs,
                  };
                  map.set(msg.frameId, entry);
                }
                if (msg.chunkIndex < entry.total && entry.parts[msg.chunkIndex] === undefined) {
                  entry.parts[msg.chunkIndex] = msg.data;
                  entry.received += 1;
                }
                if (entry.received === entry.total) {
                  const fullDataUrl = entry.parts.join("");
                  map.delete(msg.frameId);
                  // Drop older incomplete frames so stale chunks never overwrite latest screen
                  for (const [fid, other] of map.entries()) {
                    if (other.timestamp <= entry.timestamp) {
                      map.delete(fid);
                    }
                  }
                  if (fullDataUrl.startsWith("data:image/")) {
                    commitCompleteFallbackFrame(
                      fullDataUrl,
                      entry.width,
                      entry.height,
                      entry.timestamp
                    );
                  }
                }
                break;
              }

              case "video-status": {
                if (sessionRoleRef.current === "host" && msg.senderId === remotePeerIdRef.current) {
                  clientReportedWebRtcFreezeRef.current = !msg.webrtcActive;
                  if (msg.webrtcActive) {
                    frameRelayRef.current?.pause();
                  } else {
                    frameRelayRef.current?.resume();
                  }
                } else if (
                  sessionRoleRef.current === "client" &&
                  msg.senderId === remotePeerIdRef.current &&
                  typeof msg.nativeControlActive === "boolean"
                ) {
                  setHostNativeControlActive(msg.nativeControlActive);
                }
                break;
              }

              case "control-relay": {
                if (
                  sessionRoleRef.current === "host" ||
                  sessionRoleRef.current === "client"
                ) {
                  handleIncomingControlPacket(sessionRoleRef.current, msg.packet);
                }
                break;
              }

              case "transfer-relay": {
                if (
                  sessionRoleRef.current === "host" ||
                  sessionRoleRef.current === "client"
                ) {
                  handleIncomingTransferPacketRef.current(
                    sessionRoleRef.current,
                    msg.packet
                  );
                }
                break;
              }

              case "webrtc-signal": {
                if (webrtcRef.current) {
                  await webrtcRef.current.handleRemoteSignal(msg.signal);
                } else {
                  pendingSignalsRef.current.push(msg.signal);
                }
                break;
              }

              case "session-close": {
                handleEndSessionRef.current(false);
                break;
              }
            }
          } catch (err) {
            console.error("[Signaling] Message error:", err);
          }
        },
      },
      signalingMode,
      signalingUrl
    );

    signalingClientRef.current = client;

    client.connect({
      deviceId: deviceIdRef.current || undefined,
      deviceName,
      unattendedEnabled: Boolean(unattendedPasswordRef.current),
      hostSecret: hostSecretRef.current,
    });

    return () => {
      client.disconnect();
      signalingClientRef.current = null;
    };
  }, [signalingMode, signalingUrl, deviceName, sendSignaling, startFrameRelay, commitCompleteFallbackFrame, handleIncomingControlPacket]);

  // Client Initiates Connection
  const handleConnect = (targetRaw: string, password?: string) => {
    if (!deviceIdRef.current) {
      showStatusBanner("Aguardando este dispositivo ficar Online para conectar...");
      return;
    }
    const targetId = normalizeDeviceId(targetRaw);
    if (!targetId || targetId === deviceIdRef.current) {
      alert(
        "Você digitou o ID deste próprio dispositivo!\n\n" +
        "• Para testar com 2 computadores reais: conecte-se a partir de outro PC ou smartphone na mesma rede.\n" +
        "• Para testar neste mesmo computador sem o efeito de espelho infinito: ative a opção 'Simulação (1 PC)' no painel esquerdo."
      );
      return;
    }

    setIsConnecting(true);
    pendingPasswordRef.current = password || unattendedPassword;

    // Save to recents
    setRecentSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== targetId);
      return [
        {
          id: targetId,
          name: `Remoto ${formatDeviceId(targetId)}`,
          lastConnected: Date.now(),
          favorite: prev.find((s) => s.id === targetId)?.favorite ?? false,
        },
        ...filtered,
      ].slice(0, 10);
    });

    sendSignaling({
      type: "session-request",
      targetId,
      clientName: deviceName,
      clientDeviceId: deviceIdRef.current,
      hasUnattendedPassword: Boolean(password || unattendedPassword),
    });
  };

  // Host Approves Connection via Modal
  const handleAcceptIncoming = async (customPermissions: ACLPermissions) => {
    if (!incomingRequest) return;
    const client = incomingRequest.clientDeviceId;
    setIncomingRequest(null);

    aclGuardRef.current.setAll(customPermissions);
    setActiveAcl(customPermissions);
    activeAclRef.current = customPermissions;

    let stream: MediaStream;
    try {
      // 1. Capture screen FIRST (wait completely until user clicks Share)
      stream = await nativeBridge.captureScreen(undefined, { allowSyntheticFallback: false });
    } catch (err) {
      console.warn("[App] Host screen capture cancelled or failed:", err);
      sendSignaling({
        type: "session-rejected",
        targetId: client,
        senderId: deviceIdRef.current,
        reason: "Captura de tela cancelada pelo Host ou não autorizada.",
      });
      handleEndSessionRef.current(false);
      alert("A captura de tela foi cancelada. A conexão não foi iniciada.");
      return;
    }

    hostStreamRef.current = stream;
    setHostIsSyntheticStream(nativeBridge.isSyntheticStream(stream));
    remotePeerIdRef.current = client;
    sessionRoleRef.current = "host";
    setRemotePeerId(client);
    setSessionRole("host");
    setSessionActive(true);
    setIsConnecting(false);

    // 2. Notify client ONLY AFTER stream is ready so client initializes recvonly before offer
    sendSignaling({
      type: "session-accepted",
      targetId: client,
      senderId: deviceIdRef.current,
      permissions: customPermissions,
    });

    // 3. Start instant chunked WSS Frame Relay (guaranteed image even if UDP/ICE fails)
    startFrameRelay(stream, client);

    // 4. Initialize WebRTC P2P cleanly with pre-captured stream
    try {
      await setupWebRTC("host", client, stream);
    } catch (rtcErr) {
      console.warn("[App] WebRTC setup failed on Host, continuing on WSS Relay:", rtcErr);
    }
  };

  // Host upgrades synthetic unattended stream to a real user-selected screen
  const handleShareRealScreen = useCallback(async () => {
    if (sessionRoleRef.current !== "host") return;
    try {
      const newStream = await nativeBridge.captureScreen(undefined, { allowSyntheticFallback: false });
      hostStreamRef.current = newStream;
      setHostIsSyntheticStream(false);
      frameRelayRef.current?.updateStream(newStream);
      frameRelayRef.current?.resume();
      await webrtcRef.current?.replaceLocalStream(newStream);
    } catch (err) {
      console.warn("[App] Host cancelled real screen switch:", err);
    }
  }, []);

  const handleDownloadWindowsAgent = useCallback(() => {
    nativeBridge.startFastAgentPolling(180_000);
  }, []);

  const handleVerifyAgent = useCallback(() => {
    void nativeBridge.probeAgentNow();
  }, []);

  // Host Rejects Connection via Modal
  const handleRejectIncoming = (reason: string) => {
    if (!incomingRequest) return;
    sendSignaling({
      type: "session-rejected",
      targetId: incomingRequest.clientDeviceId,
      senderId: deviceIdRef.current,
      reason,
    });
    setIncomingRequest(null);
  };

  // Toggle Input Block in real time (Host ACL Guard)
  const handleToggleInputBlock = useCallback(() => {
    const newPerms = { ...activeAclRef.current, allowInput: !activeAclRef.current.allowInput };
    setActiveAcl(newPerms);
    activeAclRef.current = newPerms;
    aclGuardRef.current.updatePermissions(newPerms);

    sendControlPacketWithFallback({
      kind: "acl-update",
      permissions: newPerms,
    });
  }, [sendControlPacketWithFallback]);

  // Send input packet (Client -> Host)
  const handleSendInputPacket = useCallback(
    (packet: InputPacket) => {
      if (activeAclRef.current.allowInput) {
        sendControlPacketWithFallback(packet);
      }
    },
    [sendControlPacketWithFallback]
  );

  // Send Special Key
  const handleSendSpecialKey = useCallback(
    (action: "ctrl-alt-del" | "lock" | "esc") => {
      sendControlPacketWithFallback({
        kind: "special-key",
        action,
      });
    },
    [sendControlPacketWithFallback]
  );

  // Send Chat Message
  const handleSendChatMessage = useCallback(
    (text: string) => {
      const packet: ChatMessagePacket = {
        kind: "chat-message",
        id: safeRandomUUID(),
        sender: deviceName,
        text,
        timestamp: Date.now(),
      };
      setChatMessages((prev) => [...prev, packet]);
      sendControlPacketWithFallback(packet);
    },
    [deviceName, sendControlPacketWithFallback]
  );

  // Sync local clipboard text to Host/Client
  const handleSyncClipboardText = useCallback(
    (text: string) => {
      if (!activeAclRef.current.allowClipboard) return;
      lastSyncedClipboardTextRef.current = text;
      setLastSyncedClipboardText(text);
      sendTransferPacketWithFallback({
        kind: "clipboard-sync",
        text,
        timestamp: Date.now(),
      });
    },
    [sendTransferPacketWithFallback]
  );

  // Change stream quality preset on Host encoder
  const handleChangeQuality = useCallback(
    (quality: StreamQualityPreset) => {
      sendControlPacketWithFallback({ kind: "stream-quality", quality });
    },
    [sendControlPacketWithFallback]
  );

  // Send 1 or more files sequentially (supports drag & drop and Ctrl+V auto-paste)
  const handleSendFiles = useCallback(
    async (files: File[], options?: { autoPaste?: boolean }) => {
      if (!fileSenderRef.current || !activeAclRef.current.allowFileTransfer) {
        showStatusBanner(
          "Transferência de arquivos não permitida pelo Host nesta sessão.",
          { durationMs: 4000 }
        );
        return;
      }
      for (const file of files) {
        sendQueueRef.current = sendQueueRef.current.then(async () => {
          if (!fileSenderRef.current) return;
          try {
            showStatusBanner(`Enviando ${file.name}...`, { durationMs: 0 });
            await fileSenderRef.current.sendFile(file, options);
            showStatusBanner(
              options?.autoPaste
                ? `Arquivo enviado e colado no Host: ${file.name}`
                : `Arquivo enviado: ${file.name}`
            );
          } catch (err) {
            console.error("[App] Send file failed:", err);
            showStatusBanner(`Falha ao enviar ${file.name}`);
          }
        });
      }
    },
    [showStatusBanner]
  );

  const handleSendFile = useCallback(
    (file: File) => {
      void handleSendFiles([file], { autoPaste: false });
    },
    [handleSendFiles]
  );

  // Subscribe Host to OmniDesk Windows Agent clipboard events (Ctrl+C text & Explorer files)
  useEffect(() => {
    if (!sessionActive || sessionRole !== "host") return;

    const unsubscribe = nativeBridge.subscribeAgentEvents((event) => {
      if (event.kind === "clipboard-text") {
        if (!aclGuardRef.current.canSyncClipboard()) return;
        if (event.text === lastSyncedClipboardTextRef.current) return;
        lastSyncedClipboardTextRef.current = event.text;
        setLastSyncedClipboardText(event.text);
        sendTransferPacketWithFallback({
          kind: "clipboard-sync",
          text: event.text,
          timestamp: Date.now(),
        });
        return;
      }

      if (event.kind === "clipboard-files") {
        if (!aclGuardRef.current.canTransferFile()) return;
        const totalSize = event.files.reduce((sum, f) => sum + f.size, 0);
        const autoSend = totalSize <= 25 * 1024 * 1024;
        for (const f of event.files) {
          hostClipboardFilesMapRef.current.set(f.id, {
            name: f.name,
            size: f.size,
            mimeType: f.mimeType,
            autoSend,
          });
          if (autoSend) {
            nativeBridge.requestAgentClipboardFile(f.id);
          }
        }
        if (!autoSend) {
          sendTransferPacketWithFallback({
            kind: "clipboard-files-ready",
            files: event.files,
          });
        }
        return;
      }

      if (event.kind === "agent-clipboard-file-ready") {
        if (!aclGuardRef.current.canTransferFile()) return;
        const entry = hostClipboardFilesMapRef.current.get(event.id);
        if (!entry?.autoSend) return;
        const fileObj = new File([event.data], event.name, {
          type: event.mimeType || "application/octet-stream",
        });
        void handleSendFiles([fileObj], { autoPaste: false });
        return;
      }

      if (event.kind === "file-saved") {
        showStatusBanner(
          event.autoPaste
            ? `Colado via Ctrl+V no Windows: ${event.name}`
            : `Salvo em Downloads\\OmniDesk: ${event.name}`
        );
      }
    });

    return unsubscribe;
  }, [sessionActive, sessionRole, sendTransferPacketWithFallback, handleSendFiles, showStatusBanner]);

  // Toggle Synthetic Stream
  const handleToggleSyntheticStream = (enabled: boolean) => {
    nativeBridge.setForceSyntheticStream(enabled);
    setUseSyntheticStream(enabled);
  };

  // Terminate Active Session
  const handleEndSession = useCallback(
    (notifyPeer = true) => {
      const peerId = remotePeerIdRef.current;
      if (notifyPeer && peerId) {
        sendSignaling({
          type: "session-close",
          targetId: peerId,
          senderId: deviceIdRef.current,
          reason: "Sessão encerrada pelo usuário.",
        });
      }

      frameRelayRef.current?.stop();
      frameRelayRef.current = null;
      clearPendingMouseMove();
      lastMouseMoveSentAtRef.current = 0;
      if (hostStreamRef.current) {
        for (const track of hostStreamRef.current.getTracks()) {
          try {
            track.onended = null;
            track.stop();
          } catch {}
        }
        hostStreamRef.current = null;
      }
      setHostIsSyntheticStream(false);
      setHostNativeControlActive(null);
      setFallbackFrame(null);
      setFallbackFrameSize(null);
      setRelayStats({ fps: 0, bitrateKbps: 0 });
      frameChunkBufferRef.current.clear();
      relayMeterRef.current = {
        frames: 0,
        bytes: 0,
        windowStart: Date.now(),
        latestTimestamp: 0,
      };
      pendingSignalsRef.current = [];
      nativeBridge.releaseAllInputs();

      webrtcRef.current?.close();
      webrtcRef.current = null;
      fileSenderRef.current = null;
      fileReceiverRef.current = null;
      sessionRoleRef.current = "idle";
      remotePeerIdRef.current = "";
      setSessionActive(false);
      setSessionRole("idle");
      setRemotePeerId("");
      setRemoteStream(null);
      setIsConnecting(false);
      setTelemetry({ rttMs: 0, fps: 0, bitrateKbps: 0, packetLossPercent: 0 });
      setChatMessages([]);
      setHostReadChatCount(0);
      clientReportedWebRtcFreezeRef.current = false;
      setActiveTransferProgress(null);
      setHostChatOpen(false);
      setHostFilesOpen(false);
      setStatusBanner(null);
      setLastSyncedClipboardText("");
      lastSyncedClipboardTextRef.current = "";
      hostClipboardFilesMapRef.current.clear();
    },
    [sendSignaling, clearPendingMouseMove]
  );

  handleEndSessionRef.current = handleEndSession;

  const handleEndSessionFromUI = useCallback(() => {
    handleEndSession(true);
  }, [handleEndSession]);

  // Keep Client informed whether Host has OS-level control (Tauri or OmniDesk Windows Agent)
  useEffect(() => {
    if (sessionRole === "host" && remotePeerId && deviceIdRef.current) {
      sendSignaling({
        type: "video-status",
        targetId: remotePeerId,
        senderId: deviceIdRef.current,
        webrtcActive: webrtcRef.current?.getConnectionState() === "connected",
        nativeControlActive: controlBridgeStatus !== "browser-only",
      });
    }
  }, [sessionRole, remotePeerId, controlBridgeStatus, sendSignaling]);

  const handleWebRtcVideoActiveChange = useCallback(
    (active: boolean) => {
      if (sessionRoleRef.current === "client" && remotePeerIdRef.current && deviceIdRef.current) {
        sendSignaling({
          type: "video-status",
          targetId: remotePeerIdRef.current,
          senderId: deviceIdRef.current,
          webrtcActive: active,
        });
      }
    },
    [sendSignaling]
  );

  return (
    <div className="w-full min-h-screen bg-[#090d16] text-slate-100 flex flex-col justify-start">
      {/* 1. Client Viewport: Rendered ONLY on the computer watching/controlling remote screen */}
      {sessionRole === "client" ? (
        <RemoteSessionViewport
          remoteStream={remoteStream}
          fallbackFrame={fallbackFrame}
          fallbackFrameSize={fallbackFrameSize}
          telemetry={telemetry}
          relayStats={relayStats}
          permissions={activeAcl}
          onSendInputPacket={handleSendInputPacket}
          onToggleInputBlock={handleToggleInputBlock}
          onSendSpecialKey={handleSendSpecialKey}
          onEndSession={handleEndSessionFromUI}
          onWebRtcVideoActiveChange={handleWebRtcVideoActiveChange}
          hostNativeControlActive={hostNativeControlActive}
          chatMessages={chatMessages}
          onSendChatMessage={handleSendChatMessage}
          localSenderName={deviceName}
          activeTransferProgress={activeTransferProgress}
          onSendFile={handleSendFile}
          onSendFiles={handleSendFiles}
          onSyncClipboardText={handleSyncClipboardText}
          onChangeQuality={handleChangeQuality}
          lastSyncedClipboardText={lastSyncedClipboardText}
          statusBanner={statusBanner}
          onDismissStatusBanner={() => setStatusBanner(null)}
          receivedFiles={receivedFiles}
          isHost={false}
        />
      ) : (
        /* 2. Host & Idle Views: Host never renders RemoteSessionViewport to avoid black/blurred screen */
        <div className="w-full min-h-screen flex flex-col justify-start">
          {sessionRole === "host" && (
            <HostActiveSessionBar
              remotePeerId={remotePeerId}
              telemetry={telemetry}
              permissions={activeAcl}
              onToggleInputBlock={handleToggleInputBlock}
              onUpdatePermissions={(updates) => {
                const next = { ...activeAcl, ...updates };
                setActiveAcl(next);
                activeAclRef.current = next;
                aclGuardRef.current.updatePermissions(next);
                sendControlPacketWithFallback({
                  kind: "acl-update",
                  permissions: next,
                });
              }}
              onToggleChat={() => setHostChatOpen(!hostChatOpen)}
              onToggleFiles={() => setHostFilesOpen(!hostFilesOpen)}
              onEndSession={() => handleEndSession(true)}
              unreadChatCount={hostChatOpen ? 0 : Math.max(0, chatMessages.length - hostReadChatCount)}
              isSyntheticStream={hostIsSyntheticStream}
              onShareRealScreen={handleShareRealScreen}
              controlBridgeStatus={controlBridgeStatus}
              onDownloadWindowsAgent={handleDownloadWindowsAgent}
              onVerifyAgent={handleVerifyAgent}
            />
          )}

          <div className="flex-1 flex flex-col justify-center">
            <Dashboard
              deviceId={deviceId}
              isSignalingOnline={isSignalingOnline}
              signalingMode={signalingMode}
              signalingStatus={signalingStatus}
              onSwitchSignalingMode={handleSwitchSignalingMode}
              unattendedPassword={unattendedPassword}
              onUpdateUnattendedPassword={setUnattendedPassword}
              defaultAcl={defaultAcl}
              onUpdateDefaultAcl={(acl) => setDefaultAcl((prev) => ({ ...prev, ...acl }))}
              onConnect={handleConnect}
              recentSessions={recentSessions}
              onToggleFavorite={(id) =>
                setRecentSessions((prev) =>
                  prev.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s))
                )
              }
              onRemoveRecent={(id) =>
                setRecentSessions((prev) => prev.filter((s) => s.id !== id))
              }
              isConnecting={isConnecting}
              useSyntheticStream={useSyntheticStream}
              onToggleSyntheticStream={handleToggleSyntheticStream}
              signalingUrl={signalingUrl}
              onUpdateSignalingUrl={handleUpdateSignalingUrl}
              controlBridgeStatus={controlBridgeStatus}
              onDownloadWindowsAgent={handleDownloadWindowsAgent}
              onVerifyAgent={handleVerifyAgent}
            />
          </div>

          {/* Host Drawers for Chat & File Transfer */}
          {sessionRole === "host" && (
            <>
              <ChatDrawer
                isOpen={hostChatOpen}
                onClose={() => setHostChatOpen(false)}
                messages={chatMessages}
                onSendMessage={handleSendChatMessage}
                localSenderName={deviceName}
              />
              <FileTransferDrawer
                isOpen={hostFilesOpen}
                onClose={() => setHostFilesOpen(false)}
                activeProgress={activeTransferProgress}
                onSendFile={handleSendFile}
                onSendFiles={(files) => void handleSendFiles(files, { autoPaste: false })}
                receivedFiles={receivedFiles}
              />
              {statusBanner && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-900 border border-cyan-500/40 shadow-2xl text-xs text-slate-100">
                  {statusBanner.text}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 3. Incoming Connection Request Modal */}
      {incomingRequest && (
        <IncomingRequestModal
          clientDeviceId={incomingRequest.clientDeviceId}
          clientName={incomingRequest.clientName}
          defaultPermissions={defaultAcl}
          onAccept={handleAcceptIncoming}
          onReject={handleRejectIncoming}
        />
      )}
    </div>
  );
};
