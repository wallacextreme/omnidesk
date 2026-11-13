import React, { useEffect, useRef, useState } from "react";
import {
  ShieldAlert,
  MousePointer,
  Clipboard,
  FolderSync,
  Volume2,
  Check,
  X,
  Clock,
} from "lucide-react";
import { formatDeviceId, type ACLPermissions } from "../shared/protocol";

interface IncomingRequestModalProps {
  clientDeviceId: string;
  clientName: string;
  defaultPermissions: ACLPermissions;
  onAccept: (customPermissions: ACLPermissions) => void;
  onReject: (reason: string) => void;
}

export const IncomingRequestModal: React.FC<IncomingRequestModalProps> = ({
  clientDeviceId,
  clientName,
  defaultPermissions,
  onAccept,
  onReject,
}) => {
  const [timeLeft, setTimeLeft] = useState(30);
  const [perms, setPerms] = useState<ACLPermissions>({ ...defaultPermissions });
  const onRejectRef = useRef(onReject);
  onRejectRef.current = onReject;

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (timeLeft === 0) {
      onRejectRef.current("Tempo de espera para aprovação expirado (30s).");
    }
  }, [timeLeft]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onRejectRef.current("Solicitação cancelada pelo usuário (ESC).");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const togglePerm = (key: keyof ACLPermissions) => {
    setPerms((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div
      data-testid="incoming-request-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-fade-in"
    >
      <div className="w-full max-w-md bg-slate-900 border border-cyan-500/30 rounded-2xl p-6 shadow-2xl shadow-cyan-500/10 relative overflow-hidden">
        {/* Glowing top line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500" />

        {/* Header */}
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-6 h-6 text-cyan-400 animate-bounce" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white tracking-tight">Solicitação de Acesso Remoto</h3>
            <p className="text-xs text-slate-400">Um dispositivo solicitou controle desta estação de trabalho.</p>
          </div>
        </div>

        {/* Remote Peer Info */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400">Nome do Dispositivo:</span>
            <span className="text-sm font-semibold text-slate-200">{clientName || "Dispositivo Remoto"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">ID de Acesso:</span>
            <span className="text-sm font-mono font-bold text-cyan-400">
              {formatDeviceId(clientDeviceId)}
            </span>
          </div>
        </div>

        {/* ACL Permissions Configuration */}
        <div className="mb-6 space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
            Permissões Concedidas para esta Sessão
          </span>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => togglePerm("allowInput")}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition ${perms.allowInput ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300" : "bg-slate-950/50 border-slate-800 text-slate-500 line-through"}`}
            >
              <MousePointer className="w-4 h-4" />
              <span>Mouse/Teclado</span>
            </button>

            <button
              type="button"
              onClick={() => togglePerm("allowClipboard")}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition ${perms.allowClipboard ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300" : "bg-slate-950/50 border-slate-800 text-slate-500 line-through"}`}
            >
              <Clipboard className="w-4 h-4" />
              <span>Área de Transf.</span>
            </button>

            <button
              type="button"
              onClick={() => togglePerm("allowFileTransfer")}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition ${perms.allowFileTransfer ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300" : "bg-slate-950/50 border-slate-800 text-slate-500 line-through"}`}
            >
              <FolderSync className="w-4 h-4" />
              <span>Arquivos</span>
            </button>

            <button
              type="button"
              onClick={() => togglePerm("allowAudio")}
              className={`flex items-center gap-2 p-2.5 rounded-lg border transition ${perms.allowAudio ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300" : "bg-slate-950/50 border-slate-800 text-slate-500 line-through"}`}
            >
              <Volume2 className="w-4 h-4" />
              <span>Áudio</span>
            </button>
          </div>
        </div>

        {/* Countdown Timer */}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mb-6">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span>Auto-recusa em </span>
          <span className="font-mono font-bold text-amber-400">{timeLeft}s</span>
        </div>

        {/* Actions: Accept or Reject */}
        <div className="grid grid-cols-2 gap-3">
          <button
            data-testid="reject-request-btn"
            onClick={() => onReject("Conexão recusada pelo usuário do host.")}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 border border-slate-700 text-sm font-medium text-slate-300 active:scale-95 transition"
          >
            <X className="w-4 h-4" />
            <span>Recusar</span>
          </button>

          <button
            data-testid="accept-request-btn"
            onClick={() => onAccept(perms)}
            className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 active:scale-95 transition"
          >
            <Check className="w-4 h-4" />
            <span>Aceitar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
