import React from "react";
import {
  MousePointer,
  Clipboard,
  FolderSync,
  MessageSquare,
  XCircle,
  Activity,
  Monitor,
  Laptop,
} from "lucide-react";
import { formatDeviceId, type ACLPermissions } from "../shared/protocol";
import type { TelemetryStats } from "../core/webrtc-manager";

interface HostActiveSessionBarProps {
  remotePeerId: string;
  telemetry: TelemetryStats;
  permissions: ACLPermissions;
  onToggleInputBlock: () => void;
  onUpdatePermissions: (updates: Partial<ACLPermissions>) => void;
  onToggleChat: () => void;
  onToggleFiles: () => void;
  onEndSession: () => void;
  unreadChatCount?: number;
  isSyntheticStream?: boolean;
  onShareRealScreen?: () => void;
}

export const HostActiveSessionBar: React.FC<HostActiveSessionBarProps> = ({
  remotePeerId,
  telemetry,
  permissions,
  onToggleInputBlock,
  onUpdatePermissions,
  onToggleChat,
  onToggleFiles,
  onEndSession,
  unreadChatCount = 0,
  isSyntheticStream = false,
  onShareRealScreen,
}) => {
  return (
    <aside
      data-testid="host-active-bar"
      aria-label="Barra de Transmissão do Host"
      className="sticky top-0 z-40 w-full bg-slate-900 border-b-2 border-emerald-500 shadow-xl shadow-black/50 px-4 py-2.5 transition-all"
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left: Active Streaming Indicator & Peer ID */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>TRANSMISSÃO ATIVA</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Laptop className="w-3.5 h-3.5 text-slate-400" />
            <span>Cliente Conectado:</span>
            <span className="font-mono font-bold text-cyan-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
              {formatDeviceId(remotePeerId)}
            </span>
          </div>

          {/* Telemetry pill */}
          <div className="hidden md:flex items-center gap-3 text-[11px] text-slate-400 font-mono bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-cyan-400" />
              {telemetry.rttMs} ms
            </span>
            <span>•</span>
            <span className="text-emerald-400 font-semibold">{telemetry.fps} FPS</span>
            <span>•</span>
            <span>{telemetry.bitrateKbps} kbps</span>
          </div>
        </div>

        {/* Center/Right: ACL Controls & Actions */}
        <div className="flex items-center gap-2">
          {isSyntheticStream && onShareRealScreen && (
            <button
              data-testid="share-real-screen-btn"
              onClick={onShareRealScreen}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer"
              title="Compartilhar janela ou tela real neste dispositivo"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Compartilhar Tela Real</span>
            </button>
          )}

          {/* Toggle Mouse & Keyboard Input */}
          <button
            data-testid="toggle-input-block-btn"
            onClick={onToggleInputBlock}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              permissions.allowInput
                ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25"
                : "bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25 line-through"
            }`}
            title={permissions.allowInput ? "Input Liberado" : "Input Bloqueado"}
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span>{permissions.allowInput ? "Input Liberado" : "Input Bloqueado"}</span>
          </button>

          {/* Toggle Clipboard */}
          <button
            onClick={() => onUpdatePermissions({ allowClipboard: !permissions.allowClipboard })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              permissions.allowClipboard
                ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-750"
                : "bg-slate-950 border-slate-800 text-slate-500 line-through"
            }`}
            title="Sincronização de Área de Transferência"
          >
            <Clipboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clipboard</span>
          </button>

          {/* Toggle Files */}
          <button
            onClick={() => onUpdatePermissions({ allowFileTransfer: !permissions.allowFileTransfer })}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
              permissions.allowFileTransfer
                ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-750"
                : "bg-slate-950 border-slate-800 text-slate-500 line-through"
            }`}
            title="Permissão de Transferência de Arquivos"
          >
            <FolderSync className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Arquivos</span>
          </button>

          <div className="h-5 w-px bg-slate-800 mx-1 hidden sm:block" />

          {/* Open Chat */}
          <button
            data-testid="toggle-chat-btn"
            onClick={onToggleChat}
            className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer border border-slate-700"
            title="Abrir Chat"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 text-[10px] font-bold text-slate-950 flex items-center justify-center">
                {unreadChatCount}
              </span>
            )}
          </button>

          {/* Open Files Drawer */}
          <button
            onClick={onToggleFiles}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer border border-slate-700"
            title="Gerenciador de Arquivos"
          >
            <FolderSync className="w-3.5 h-3.5" />
          </button>

          {/* Large Panic Button */}
          <button
            data-testid="end-session-btn"
            onClick={onEndSession}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-950/40 transition-colors cursor-pointer"
            title="Interromper sessão e desconectar cliente imediatamente"
          >
            <XCircle className="w-4 h-4" />
            <span>Encerrar / Pânico</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
