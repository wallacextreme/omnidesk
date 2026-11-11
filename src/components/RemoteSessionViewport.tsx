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
  telemetry: TelemetryStats;
  permissions: ACLPermissions;
  onSendInputPacket: (packet: InputPacket) => void;
  onToggleInputBlock: () => void;
  onSendSpecialKey: (action: "ctrl-alt-del" | "lock" | "esc") => void;
  onEndSession: () => void;
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
  telemetry,
  permissions,
  onSendInputPacket,
  onToggleInputBlock,
  onSendSpecialKey,
  onEndSession,
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

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [quality, setQuality] = useState<"performance" | "balanced" | "original">("balanced");
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [showMirrorTip, setShowMirrorTip] = useState(true);

  // Attach stream to video element
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.play().catch((err) => {
        console.warn("[RemoteViewport] Auto-play video error:", err);
      });
    }
  }, [remoteStream]);

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
      {/* Session Top HUD */}
      <SessionHUD
        telemetry={telemetry}
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

      {/* Info Tip for Self-Testing to Explain the Droste / Mirror Effect */}
      {showMirrorTip && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-4 py-2 rounded-xl bg-slate-900/95 border border-cyan-500/30 text-xs text-slate-200 backdrop-blur-md shadow-2xl max-w-lg">
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

      {/* Hardware Accelerated Video Stream */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain pointer-events-none"
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
