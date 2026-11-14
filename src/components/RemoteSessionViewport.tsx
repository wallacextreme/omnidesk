import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, UploadCloud, X } from "lucide-react";
import {
  InputController,
  calculateNormalizedCoordinates,
} from "../core/input-controller";
import { nativeBridge } from "../core/native-bridge";
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
  hostNativeControlActive?: boolean | null;
  chatMessages: ChatMessagePacket[];
  onSendChatMessage: (text: string) => void;
  localSenderName: string;
  activeTransferProgress: FileTransferProgress | null;
  onSendFile: (file: File) => void;
  onSendFiles?: (files: File[], options?: { autoPaste?: boolean }) => void;
  onSyncClipboardText?: (text: string) => void;
  onChangeQuality?: (q: "performance" | "balanced" | "original") => void;
  lastSyncedClipboardText?: string;
  statusBanner?: {
    id: string;
    text: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null;
  onDismissStatusBanner?: () => void;
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
  hostNativeControlActive = null,
  chatMessages,
  onSendChatMessage,
  localSenderName,
  activeTransferProgress,
  onSendFile,
  onSendFiles,
  onSyncClipboardText,
  onChangeQuality: onChangeQualityProp,
  lastSyncedClipboardText,
  statusBanner,
  onDismissStatusBanner,
  receivedFiles,
  isHost,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const captureOverlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputControllerRef = useRef<InputController | null>(null);
  const onWebRtcVideoActiveChangeRef = useRef(onWebRtcVideoActiveChange);
  onWebRtcVideoActiveChangeRef.current = onWebRtcVideoActiveChange;
  const onSendInputPacketRef = useRef(onSendInputPacket);
  onSendInputPacketRef.current = onSendInputPacket;
  const onEndSessionRef = useRef(onEndSession);
  onEndSessionRef.current = onEndSession;
  const allowInputRef = useRef(permissions.allowInput);
  allowInputRef.current = permissions.allowInput;
  const allowClipboardRef = useRef(permissions.allowClipboard);
  allowClipboardRef.current = permissions.allowClipboard;
  const allowFileTransferRef = useRef(permissions.allowFileTransfer);
  allowFileTransferRef.current = permissions.allowFileTransfer;
  const onSendFileRef = useRef(onSendFile);
  onSendFileRef.current = onSendFile;
  const onSendFilesRef = useRef(onSendFiles);
  onSendFilesRef.current = onSendFiles;
  const onSyncClipboardTextRef = useRef(onSyncClipboardText);
  onSyncClipboardTextRef.current = onSyncClipboardText;
  const lastSyncedClipboardTextRef = useRef(lastSyncedClipboardText ?? "");
  const fallbackFrameSizeRef = useRef(fallbackFrameSize);
  fallbackFrameSizeRef.current = fallbackFrameSize;

  useEffect(() => {
    if (lastSyncedClipboardText !== undefined) {
      lastSyncedClipboardTextRef.current = lastSyncedClipboardText;
    }
  }, [lastSyncedClipboardText]);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [quality, setQuality] = useState<"performance" | "balanced" | "original">("balanced");
  const [hideLocalCursor, setHideLocalCursor] = useState(false);
  const [isPointerOverVideo, setIsPointerOverVideo] = useState(false);
  const [isViewportDragOver, setIsViewportDragOver] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [showMirrorTip, setShowMirrorTip] = useState(true);
  const [showViewOnlyNotice, setShowViewOnlyNotice] = useState(true);
  const [clickRipple, setClickRipple] = useState<{ x: number; y: number; key: number } | null>(null);
  const clickRippleSeqRef = useRef(0);
  const [isWebRtcPlaying, setIsWebRtcPlaying] = useState(false);

  useEffect(() => {
    if (!clickRipple) return;
    const timer = window.setTimeout(() => {
      setClickRipple(null);
    }, 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [clickRipple]);
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
        onEndSessionRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isChatOpen, isFilesOpen]);

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

  // Setup InputController strictly on the capture overlay (never steals clicks/keys from HUD or Drawers)
  useEffect(() => {
    if (isHost) return;

    const controller = new InputController({
      interceptClipboardShortcuts: true,
      onInputPacket: (packet) => {
        if (allowInputRef.current) {
          onSendInputPacketRef.current(packet);
        }
      },
    });

    inputControllerRef.current = controller;

    if (captureOverlayRef.current && videoRef.current) {
      controller.attach(captureOverlayRef.current, videoRef.current);
      if (fallbackFrameSize) {
        controller.setFallbackDimensions(fallbackFrameSize.width, fallbackFrameSize.height);
      }
    }

    return () => {
      controller.detach();
      inputControllerRef.current = null;
    };
  }, [isHost]);

  // AnyDesk-style Ctrl+C -> Ctrl+V (files & text) via browser paste event
  useEffect(() => {
    if (isHost) return;
    let mounted = true;

    const handlePaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || activeEl?.isContentEditable) {
        return;
      }

      if (!allowFileTransferRef.current && !allowClipboardRef.current) {
        inputControllerRef.current?.markLocalPasteHandled(false, 0);
        return;
      }

      const dt = e.clipboardData;
      const fileList: File[] = [];
      if (dt?.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files[i];
          if (f) fileList.push(f);
        }
      } else if (dt?.items && dt.items.length > 0) {
        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i];
          if (item && item.kind === "file") {
            const f = item.getAsFile();
            if (f) fileList.push(f);
          }
        }
      }

      if (fileList.length > 0 && allowFileTransferRef.current) {
        e.preventDefault();
        inputControllerRef.current?.markLocalPasteHandled(true);
        if (onSendFilesRef.current) {
          onSendFilesRef.current(fileList, { autoPaste: true });
        } else {
          for (const f of fileList) {
            onSendFileRef.current(f);
          }
        }
        return;
      }

      const pastedText = dt?.getData("text/plain") ?? "";
      if (pastedText.length > 0 && allowClipboardRef.current) {
        if (pastedText === lastSyncedClipboardTextRef.current) {
          inputControllerRef.current?.markLocalPasteHandled(false, 0);
        } else {
          lastSyncedClipboardTextRef.current = pastedText;
          onSyncClipboardTextRef.current?.(pastedText);
          inputControllerRef.current?.markLocalPasteHandled(false, 45);
        }
        return;
      }

      // Fallback when browser DataTransfer hides native OS CF_HDROP files (e.g. .exe / .msi in WebView2 / strict Chrome)
      if (allowFileTransferRef.current && nativeBridge.hasNativeOSControl()) {
        inputControllerRef.current?.extendPasteWait(350);
        void (async () => {
          try {
            const nativeEntries = await nativeBridge.getNativeClipboardFileEntries();
            if (!mounted) return;
            if (nativeEntries.length === 0) {
              inputControllerRef.current?.markLocalPasteHandled(false, 0);
              return;
            }
            inputControllerRef.current?.markLocalPasteHandled(true);
            const loadedFiles: File[] = [];
            for (const entry of nativeEntries) {
              const f = await nativeBridge.readNativeClipboardFile(entry);
              if (f) loadedFiles.push(f);
            }
            if (!mounted || loadedFiles.length === 0) return;
            if (onSendFilesRef.current) {
              onSendFilesRef.current(loadedFiles, { autoPaste: true });
            } else {
              for (const f of loadedFiles) {
                onSendFileRef.current(f);
              }
            }
          } catch {
            if (mounted) {
              inputControllerRef.current?.markLocalPasteHandled(false, 0);
            }
          }
        })();
        return;
      }

      inputControllerRef.current?.markLocalPasteHandled(false, 0);
    };

    window.addEventListener("paste", handlePaste);
    return () => {
      mounted = false;
      window.removeEventListener("paste", handlePaste);
    };
  }, [isHost]);

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

  const dispatchFilesToHost = (fileList: FileList | null, autoPaste = false) => {
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList);
    if (onSendFilesRef.current) {
      onSendFilesRef.current(arr, { autoPaste });
    } else {
      for (const f of arr) {
        onSendFileRef.current(f);
      }
    }
  };

  const handleQualityChange = (q: "performance" | "balanced" | "original") => {
    setQuality(q);
    onChangeQualityProp?.(q);
  };

  const isFallbackRelay = !isWebRtcPlaying && Boolean(fallbackFrame);

  const showRemoteCursorOnly =
    permissions.allowInput &&
    hideLocalCursor &&
    isWebRtcPlaying &&
    !isFallbackRelay &&
    isPointerOverVideo;

  return (
    <div
      id="remote-viewport-container"
      data-testid="remote-viewport"
      ref={containerRef}
      onDragOver={(e) => {
        if (isHost || !permissions.allowFileTransfer) return;
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!isViewportDragOver) setIsViewportDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsViewportDragOver(false);
        }
      }}
      onDrop={(e) => {
        if (isHost || !permissions.allowFileTransfer) return;
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          setIsViewportDragOver(false);
          dispatchFilesToHost(e.dataTransfer.files, false);
        } else {
          setIsViewportDragOver(false);
        }
      }}
      className="relative w-screen h-screen bg-black overflow-hidden flex items-center justify-center select-none cursor-default outline-none"
    >
      {/* Fixed Emergency Escape Button - Hidden when right drawer is open so drawer close button stays unobstructed */}
      {!isChatOpen && !isFilesOpen && (
        <button
          onClick={onEndSession}
          className="fixed top-4 right-4 z-30 pointer-events-auto flex items-center gap-2 px-3.5 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-500 text-white font-medium text-xs shadow-xl shadow-rose-950/50 border border-rose-400/30 transition-all cursor-pointer group"
          title="Encerrar sessão e voltar ao painel (ESC)"
        >
          <X className="w-4 h-4 group-hover:rotate-90 transition-transform" />
          <span>Encerrar (ESC)</span>
        </button>
      )}

      {/* Session Top HUD */}
      <SessionHUD
        telemetry={telemetry}
        isFallbackRelay={!isWebRtcPlaying && Boolean(fallbackFrame)}
        {...(relayStats ? { relayStats } : {})}
        hostNativeControlActive={hostNativeControlActive}
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
        onChangeQuality={handleQualityChange}
        hideLocalCursor={hideLocalCursor}
        onToggleHideLocalCursor={() => setHideLocalCursor((v) => !v)}
        isHost={isHost}
      />

      {/* Viewport Drag & Drop File Overlay */}
      {isViewportDragOver && !isHost && (
        <div
          data-testid="viewport-drop-overlay"
          className="fixed inset-0 z-30 pointer-events-none flex items-center justify-center bg-slate-950/85 border-4 border-dashed border-cyan-400"
        >
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl px-8 py-6 flex flex-col items-center gap-3 shadow-2xl">
            <UploadCloud className="w-12 h-12 text-cyan-400" />
            <p className="text-base font-bold text-white">
              Solte aqui para enviar ao Host
            </p>
            <p className="text-xs text-slate-400">
              Os arquivos serão entregues na pasta Downloads\OmniDesk e na Área de Transferência do Host
            </p>
          </div>
        </div>
      )}

      {/* Non-intrusive Status / Clipboard / File Toast */}
      {statusBanner && (
        <div
          data-testid="session-status-banner"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900 border border-cyan-500/40 shadow-2xl text-xs text-slate-100 max-w-md"
        >
          <span className="truncate">{statusBanner.text}</span>
          {statusBanner.actionLabel && statusBanner.onAction && (
            <button
              type="button"
              onClick={statusBanner.onAction}
              className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-cyan-200 font-semibold whitespace-nowrap transition"
            >
              {statusBanner.actionLabel}
            </button>
          )}
          {onDismissStatusBanner && (
            <button
              type="button"
              onClick={onDismissStatusBanner}
              className="p-0.5 text-slate-400 hover:text-white transition"
              title="Fechar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

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
        <div
          className={`fixed top-16 left-0 ${
            isChatOpen || isFilesOpen ? "right-0 sm:right-96" : "right-0"
          } z-30 pointer-events-none flex justify-center px-3 transition-all`}
        >
          <div className="pointer-events-auto flex items-center gap-2.5 px-4 py-2 rounded-xl bg-slate-900/95 border border-cyan-500/30 text-xs text-slate-200 shadow-2xl max-w-lg">
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
        className={`w-full h-full object-contain pointer-events-none ${
          isWebRtcPlaying ? "opacity-100" : "opacity-0 absolute inset-0"
        }`}
      />

      {/* Transparent pointer capture overlay covering ONLY the remote video area */}
      <div
        ref={captureOverlayRef}
        data-testid="remote-input-capture"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const video = videoRef.current;
          const fs = fallbackFrameSizeRef.current;
          const norm = calculateNormalizedCoordinates(
            e.clientX,
            e.clientY,
            rect,
            video?.videoWidth || fs?.width || 0,
            video?.videoHeight || fs?.height || 0
          );
          setIsPointerOverVideo(!norm.outOfBounds);
        }}
        onMouseLeave={() => setIsPointerOverVideo(false)}
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          clickRippleSeqRef.current += 1;
          setClickRipple({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            key: clickRippleSeqRef.current,
          });
        }}
        className={`absolute inset-0 z-[5] pointer-events-auto outline-none ${
          !permissions.allowInput
            ? "cursor-not-allowed"
            : showRemoteCursorOnly
              ? "cursor-none"
              : "cursor-default"
        }`}
      />

      {/* Brief single-shot visual click ripple so client sees immediate click feedback without lingering */}
      {clickRipple && (
        <div
          key={clickRipple.key}
          data-testid="click-ripple"
          style={{
            left: clickRipple.x - 10,
            top: clickRipple.y - 10,
          }}
          className="fixed w-5 h-5 rounded-full border-2 border-cyan-400/80 pointer-events-none z-[6] animate-click-ripple"
          onAnimationEnd={() => setClickRipple(null)}
        />
      )}

      {/* Clear warning when Host is in Browser-Only Mode without Windows Agent */}
      {hostNativeControlActive === false && showViewOnlyNotice && (
        <div
          className={`fixed bottom-4 left-0 ${
            isChatOpen || isFilesOpen ? "right-0 sm:right-96" : "right-0"
          } z-40 pointer-events-none flex justify-center px-4 transition-all`}
        >
          <div
            data-testid="view-only-warning"
            className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-950/95 border border-amber-500/40 text-xs text-amber-200 shadow-2xl max-w-2xl"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="flex-1">
              <strong>Modo Visualização no Host:</strong> O computador Host está rodando apenas no navegador sem o{" "}
              <strong>Agente Windows OmniDesk</strong> aberto. Para clicar nos ícones/programas do Windows lá, peça para o Host baixar e abrir o Agente na barra superior dele.
            </span>
            <button
              onClick={() => setShowViewOnlyNotice(false)}
              className="p-1 rounded-lg hover:bg-amber-900/60 text-amber-300 hover:text-white cursor-pointer"
              title="Fechar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

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
        {...(onSendFiles ? { onSendFiles: (files: File[]) => onSendFiles(files, { autoPaste: false }) } : {})}
        receivedFiles={receivedFiles}
      />
    </div>
  );
};
