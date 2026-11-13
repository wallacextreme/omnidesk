import React, { useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";
import { InputController } from "../core/input-controller";
import { SessionHUD } from "./SessionHUD";
import { ChatDrawer } from "./ChatDrawer";
import { FileTransferDrawer } from "./FileTransferDrawer";
import type { TelemetryStats } from "../core/webrtc-manager";
import type { ACLPermissions, ChatMessagePacket, InputPacket } from "../shared/protocol";
import type { FileTransferProgress } from "../core/file-transfer";

interface RemoteSessionViewportProps {
  remoteStream: MediaStream | null;
  fallbackFrame?: string | null;
  fallbackFrameSize?: { width: number; height: number } | null;
  telemetry: TelemetryStats;
  relayStats?: { fps: number; bitrateKbps: number };
  permissions: ACLPermissions;
  onSendInputPacket: (packet: InputPacket) => void;
  onToggleInputBlock: () => void;
  onSendSpecialKey: (action: "ctrl-alt-del" | "lock" | "esc") => void;
  onEndSession: () => void;
  onWebRtcVideoActiveChange?: (active: boolean) => void;
  chatMessages: ChatMessagePacket[];
  onSendChatMessage: (text: string) => void;
  localSenderName: string;
  activeTransferProgress: FileTransferProgress | null;
  onSendFile: (file: File) => void;
  receivedFiles: Array<{ name: string; size: number; blob: Blob; sha256: string }>;
  isHost: boolean;
}

export const RemoteSessionViewport: React.FC<RemoteSessionViewportProps> = ({
  remoteStream,
  fallbackFrame,
  fallbackFrameSize,
  telemetry,
  relayStats,
  permissions,
  onSendInputPacket,
  onToggleInputBlock,
  onSendSpecialKey,
  onEndSession,
  onWebRtcVideoActiveChange,
  chatMessages,
  onSendChatMessage,
  localSenderName,
  activeTransferProgress,
  onSendFile,
  receivedFiles,
  isHost,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputControllerRef = useRef<InputController | null>(null);
  const onWebRtcVideoActiveChangeRef = useRef(onWebRtcVideoActiveChange);
  onWebRtcVideoActiveChangeRef.current = onWebRtcVideoActiveChange;

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [quality, setQuality] = useState<"performance" | "balanced" | "original">("balanced");
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [showMirrorTip, setShowMirrorTip] = useState(true);
  const [isWebRtcPlaying, setIsWebRtcPlaying] = useState(false);
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState(false);

  // Monitor arrival of fallback WSS frame
  useEffect(() => {
    if (fallbackFrame) {
      setHasReceivedFirstFrame(true);
    }
  }, [fallbackFrame]);

  // Keep InputController fallback dimensions synced when WSS frame arrives
  useEffect(() => {
    if (fallbackFrameSize && inputControllerRef.current) {
      inputControllerRef.current.setFallbackDimensions(
        fallbackFrameSize.width,
        fallbackFrameSize.height
      );
    }
  }, [fallbackFrameSize]);

  // Notify parent when real WebRTC decoded video becomes active/inactive
  useEffect(() => {
    onWebRtcVideoActiveChangeRef.current?.(isWebRtcPlaying);
  }, [isWebRtcPlaying]);

  // Attach stream to video element and verify actual decoded video frames (videoWidth > 0)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!remoteStream) {
      if (video.srcObject !== null) {
        video.srcObject = null;
      }
      setIsWebRtcPlaying(false);
      return;
    }

    if (video.srcObject !== remoteStream) {
      video.srcObject = remoteStream;
    }
    video.muted = true; // Crucial to prevent browser blocking autoplay
    video.play().catch((err) => {
      console.warn("[RemoteViewport] Auto-play video warning:", err);
    });

    const verifyVideoFrames = () => {
      const hasDecodedFrame =
        video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
      setIsWebRtcPlaying(hasDecodedFrame);
    };

    verifyVideoFrames();
    const poll = setInterval(verifyVideoFrames, 400);
    return () => clearInterval(poll);
  }, [remoteStream]);

  // Global ESC key listener to safely exit session from anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isChatOpen) {
          setIsChatOpen(false);
          return;
        }
        if (isFilesOpen) {
          setIsFilesOpen(false);
          return;
        }
        onEndSession();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEndSession, isChatOpen, isFilesOpen]);

  // Setup 60fps video frame callback telemetry
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !("requestVideoFrameCallback" in video)) return;

    let callbackId: number;
    const onFrame: VideoFrameRequestCallback = () => {
      callbackId = video.requestVideoFrameCallback(onFrame);
    };
    callbackId = video.requestVideoFrameCallback(onFrame);

    return () => {
      if ("cancelVideoFrameCallback" in video) {
        video.cancelVideoFrameCallback(callbackId);
      }
    };
  }, []);

  // Setup InputController if not host (Client controls Host)
  useEffect(() => {
    if (isHost) return;

    const controller = new InputController({
      onInputPacket: (packet) => {
        if (permissions.allowInput) {
          onSendInputPacket(packet);
        }
      },
    });

    inputControllerRef.current = controller;

    if (containerRef.current && videoRef.current) {
      controller.attach(containerRef.current, videoRef.current);
      if (fallbackFrameSize) {
        controller.setFallbackDimensions(fallbackFrameSize.width, fallbackFrameSize.height);
      }
    }

    return () => {
      controller.detach();
      inputControllerRef.current = null;
    };
  }, [isHost, permissions.allowInput, onSendInputPacket]);

  // Handle unread messages
  useEffect(() => {
    if (!isChatOpen && chatMessages.length > 0) {
      setUnreadChatCount((prev) => prev + 1);
    }
  }, [chatMessages.length, isChatOpen]);

  const handleOpenChat = () => {
    setIsChatOpen(true);
    setUnreadChatCount(0);
  };

  return (
    <div
      id="remote-viewport-container"
      data-testid="remote-viewport"
      ref={containerRef}
      className="relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none cursor-default outline-none"
    >
      {/* Fixed Emergency Escape Button - Always visible and clickable */}
      <button
        onClick={onEndSession}
        className="fixed top-4 right-4 z-[9999] pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white font-medium text-xs shadow-xl shadow-rose-950/50 border border-rose-400/30 transition-all cursor-pointer group"
        title="Encerrar sessão e voltar ao painel (ESC)"
      >
        <X className="w-4 h-4 group-hover:rotate-90 transition-transform" />
        <span>Encerrar (ESC)</span>
      </button>

      {/* Session Top HUD */}
      <SessionHUD
        telemetry={telemetry}
        isFallbackRelay={!isWebRtcPlaying && Boolean(fallbackFrame)}
        {...(relayStats ? { relayStats } : {})}
        permissions={permissions}
        onToggleInputBlock={onToggleInputBlock}
        onSendSpecialKey={onSendSpecialKey}
        onToggleChat={handleOpenChat}
        onToggleFiles={() => setIsFilesOpen(!isFilesOpen)}
        onEndSession={onEndSession}
        isChatOpen={isChatOpen}
        isFilesOpen={isFilesOpen}
        unreadChatCount={unreadChatCount}
        quality={quality}
        onChangeQuality={setQuality}
        isHost={isHost}
      />

      {/* Waiting for Host video stream loader (unblurred, clear instructions) */}
      {!isWebRtcPlaying && !fallbackFrame && !hasReceivedFirstFrame && (
        <div
          data-testid="waiting-video-overlay"
          className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-300 z-10 pointer-events-none select-none"
        >
          <div className="w-12 h-12 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin mb-4" />
          <p className="text-sm font-semibold text-white mb-1">Aguardando transmissão de vídeo do Host...</p>
          <p className="text-xs text-slate-400">Pressione ESC ou clique no botão acima a qualquer momento para cancelar.</p>
        </div>
      )}

      {/* Info Tip for Self-Testing to Explain the Droste / Mirror Effect */}
      {showMirrorTip && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-4 py-2 rounded-xl bg-slate-900/95 border border-cyan-500/30 text-xs text-slate-200 shadow-2xl max-w-lg">
          <Info className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="flex-1">
            <strong>Dica de Uso:</strong> Ao testar no mesmo computador, compartilhe uma <em>Janela Específica</em> ou use outro PC/celular para evitar o efeito de túnel de espelhos.
          </span>
          <button
            onClick={() => setShowMirrorTip(false)}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
            title="Fechar aviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Fallback Image Frame (Rendered when WebRTC is negotiating/slow or on legacy systems) */}
      {!isWebRtcPlaying && fallbackFrame && (
        <img
          data-testid="remote-fallback-image"
          src={fallbackFrame}
          alt="Transmissão Remota em Tempo Real"
          className="w-full h-full object-contain pointer-events-none select-none"
        />
      )}

      {/* Hardware Accelerated Video Stream (Always mounted) */}
      <video
        ref={videoRef}
        data-testid="remote-video-element"
        autoPlay
        playsInline
        muted
        onPlaying={() => {
          if (
            videoRef.current &&
            videoRef.current.readyState >= 2 &&
            videoRef.current.videoWidth > 0 &&
            videoRef.current.videoHeight > 0
          ) {
            setIsWebRtcPlaying(true);
          }
        }}
        onLoadedData={() => {
          if (
            videoRef.current &&
            videoRef.current.readyState >= 2 &&
            videoRef.current.videoWidth > 0 &&
            videoRef.current.videoHeight > 0
          ) {
            setIsWebRtcPlaying(true);
          }
        }}
        onResize={() => {
          if (
            videoRef.current &&
            videoRef.current.readyState >= 2 &&
            videoRef.current.videoWidth > 0 &&
            videoRef.current.videoHeight > 0
          ) {
            setIsWebRtcPlaying(true);
          }
        }}
        onEmptied={() => setIsWebRtcPlaying(false)}
        className={`w-full h-full object-contain pointer-events-none transition-opacity duration-300 ${
          isWebRtcPlaying ? "opacity-100" : "opacity-0 absolute inset-0"
        }`}
      />

      {/* Transparent pointer capture overlay */}
      <div className="absolute inset-0 pointer-events-auto" />

      {/* Side Drawers */}
      <ChatDrawer
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={chatMessages}
        onSendMessage={onSendChatMessage}
        localSenderName={localSenderName}
      />

      <FileTransferDrawer
        isOpen={isFilesOpen}
        onClose={() => setIsFilesOpen(false)}
        activeProgress={activeTransferProgress}
        onSendFile={onSendFile}
        receivedFiles={receivedFiles}
      />
    </div>
  );
};
