import React, { useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  Activity,
  Sliders,
  ShieldBan,
  ShieldCheck,
  MessageSquare,
  FolderUp,
  Maximize2,
  Minimize2,
  PhoneOff,
  Command,
  Monitor,
} from "lucide-react";
import type { TelemetryStats } from "../core/webrtc-manager";
import type { ACLPermissions } from "../shared/protocol";

interface SessionHUDProps {
  telemetry: TelemetryStats;
  permissions: ACLPermissions;
  onToggleInputBlock: () => void;
  onSendSpecialKey: (action: "ctrl-alt-del" | "lock" | "esc") => void;
  onToggleChat: () => void;
  onToggleFiles: () => void;
  onEndSession: () => void;
  isChatOpen: boolean;
  isFilesOpen: boolean;
  unreadChatCount: number;
  quality: "performance" | "balanced" | "original";
  onChangeQuality: (q: "performance" | "balanced" | "original") => void;
  isHost: boolean;
}

export const SessionHUD: React.FC<SessionHUDProps> = ({
  telemetry,
  permissions,
  onToggleInputBlock,
  onSendSpecialKey,
  onToggleChat,
  onToggleFiles,
  onEndSession,
  isChatOpen,
  isFilesOpen,
  unreadChatCount,
  quality,
  onChangeQuality,
  isHost,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Semantic latency coloring
  // Green: < 30ms, Yellow: 30-80ms, Red: > 80ms
  const pingColor =
    telemetry.rttMs <= 30
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : telemetry.rttMs <= 80
        ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
        : "text-rose-400 bg-rose-500/10 border-rose-500/20";

  const dotColor =
    telemetry.rttMs <= 30
      ? "bg-emerald-400"
      : telemetry.rttMs <= 80
        ? "bg-amber-400"
        : "bg-rose-400";

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 transition-all duration-300">
      {isCollapsed ? (
        <button
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-900/90 border border-slate-700 backdrop-blur-md shadow-2xl text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition"
        >
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span>{telemetry.rttMs} ms</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      ) : (
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800/90 backdrop-blur-xl shadow-2xl shadow-black/80">
          {/* Telemetry Indicator */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono font-medium ${pingColor}`}>
            <span className={`w-2 h-2 rounded-full ${dotColor} animate-pulse`} />
            <span>{telemetry.rttMs}ms</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-300">{telemetry.fps} FPS</span>
            {telemetry.bitrateKbps > 0 && (
              <>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">{telemetry.bitrateKbps} kbps</span>
              </>
            )}
          </div>

          <div className="h-5 w-px bg-slate-800" />

          {/* Quality Selector */}
          <div className="relative">
            <button
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
              title="Ajustar Qualidade do Stream"
            >
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span className="capitalize">{quality}</span>
            </button>

            {showQualityMenu && (
              <div className="absolute top-full mt-2 left-0 bg-slate-900 border border-slate-800 rounded-xl p-1 shadow-xl text-xs space-y-0.5 w-36">
                {(["performance", "balanced", "original"] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      onChangeQuality(q);
                      setShowQualityMenu(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg capitalize transition ${quality === q ? "bg-cyan-500/20 text-cyan-300 font-medium" : "text-slate-300 hover:bg-slate-800"}`}
                  >
                    {q === "performance" && "Performance (720p)"}
                    {q === "balanced" && "Equilibrado (1080p)"}
                    {q === "original" && "Qualidade Máx."}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input Block Toggle (Host or Client) */}
          <button
            data-testid="toggle-input-block-btn"
            onClick={onToggleInputBlock}
            className={`p-2 rounded-xl text-xs transition ${permissions.allowInput ? "text-slate-400 hover:text-white hover:bg-slate-800" : "bg-rose-500/20 text-rose-300 border border-rose-500/30"}`}
            title={permissions.allowInput ? "Bloquear Input Remoto" : "Input Bloqueado (Clique para Desbloquear)"}
          >
            {permissions.allowInput ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldBan className="w-4 h-4 text-rose-400" />}
          </button>

          {/* Special Key: Ctrl+Alt+Del */}
          <button
            data-testid="send-cad-btn"
            onClick={() => onSendSpecialKey("ctrl-alt-del")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition"
            title="Enviar Ctrl+Alt+Del"
          >
            <Command className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">CAD</span>
          </button>

          {/* Chat Toggle */}
          <button
            data-testid="toggle-chat-btn"
            onClick={onToggleChat}
            className={`relative p-2 rounded-xl text-xs transition ${isChatOpen ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white hover:bg-slate-800"}`}
            title="Abrir Chat"
          >
            <MessageSquare className="w-4 h-4" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 text-slate-950 font-bold text-[10px] flex items-center justify-center">
                {unreadChatCount}
              </span>
            )}
          </button>

          {/* Files Toggle */}
          <button
            data-testid="toggle-files-btn"
            onClick={onToggleFiles}
            className={`p-2 rounded-xl text-xs transition ${isFilesOpen ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white hover:bg-slate-800"}`}
            title="Transferência de Arquivos"
          >
            <FolderUp className="w-4 h-4" />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Alternar Tela Cheia"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <div className="h-5 w-px bg-slate-800" />

          {/* End Session Button */}
          <button
            data-testid="end-session-btn"
            onClick={onEndSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/90 hover:bg-rose-500 active:scale-95 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition"
            title="Encerrar Sessão"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>Desconectar</span>
          </button>

          {/* Collapse HUD Button */}
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition ml-1"
            title="Recolher Barra"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
