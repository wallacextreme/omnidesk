import React, { useState } from "react";
import {
  Copy,
  Check,
  Shield,
  KeyRound,
  Eye,
  EyeOff,
  Monitor,
  MousePointer,
  Clipboard,
  FolderSync,
  Volume2,
  ArrowRight,
  Clock,
  Star,
  Trash2,
  Laptop,
  Wifi,
  WifiOff,
  FlaskConical,
} from "lucide-react";
import { formatDeviceId, type ACLPermissions } from "../shared/protocol";

export interface RecentSession {
  id: string;
  name: string;
  lastConnected: number;
  favorite: boolean;
}

interface DashboardProps {
  deviceId: string;
  isSignalingOnline: boolean;
  unattendedPassword: string;
  onUpdateUnattendedPassword: (pwd: string) => void;
  defaultAcl: ACLPermissions;
  onUpdateDefaultAcl: (acl: Partial<ACLPermissions>) => void;
  onConnect: (targetId: string, password?: string) => void;
  recentSessions: RecentSession[];
  onToggleFavorite: (id: string) => void;
  onRemoveRecent: (id: string) => void;
  isConnecting: boolean;
  useSyntheticStream?: boolean;
  onToggleSyntheticStream?: (enabled: boolean) => void;
  signalingUrl?: string;
  onUpdateSignalingUrl?: (url: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  deviceId,
  isSignalingOnline,
  unattendedPassword,
  onUpdateUnattendedPassword,
  defaultAcl,
  onUpdateDefaultAcl,
  onConnect,
  recentSessions,
  onToggleFavorite,
  onRemoveRecent,
  isConnecting,
  useSyntheticStream = false,
  onToggleSyntheticStream,
  signalingUrl,
  onUpdateSignalingUrl,
}) => {
  const [remoteInput, setRemoteInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    if (!deviceId) return;
    navigator.clipboard.writeText(formatDeviceId(deviceId));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemoteInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 9);
    setRemoteInput(raw);
  };

  const handleSubmitConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (remoteInput.length >= 9) {
      onConnect(remoteInput);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header bar */}
      <header className="flex items-center justify-between pb-8 border-b border-slate-800/80 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Monitor className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              OmniDesk <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono font-medium">PRO</span>
            </h1>
            <p className="text-xs text-slate-400">Acesso Remoto P2P de Ultra-Baixa Latência</p>
          </div>
        </div>

        {/* Signaling Status Badge & Config */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const current = signalingUrl || (typeof window !== "undefined" ? `ws://${window.location.hostname}:4000` : "ws://localhost:4000");
              const next = prompt(
                "Configurar Endereço do Servidor de Sinalização (WebSocket):\nExemplo para 2 PCs na mesma rede: ws://192.168.1.138:4000\nExemplo local: ws://localhost:4000",
                current
              );
              if (next && onUpdateSignalingUrl) {
                onUpdateSignalingUrl(next.trim());
              }
            }}
            title="Clique para configurar o IP do servidor de sinalização"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs transition-colors cursor-pointer"
          >
            {isSignalingOnline ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-slate-300 font-medium">Sinalização Online</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-rose-300 font-medium">Desconectado (Alterar IP)</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Disconnected / HTTPS LAN Guidance Banner */}
      {!isSignalingOnline && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-3">
          <span className="text-base leading-none">⚠️</span>
          <div>
            <p className="font-semibold mb-1">Servidor de Sinalização Desconectado</p>
            <p className="text-slate-300 leading-relaxed">
              • Se estiver conectando dois computadores reais (ex: <strong>Windows 7</strong> e <strong>Windows 10/11</strong> na mesma rede local): certifique-se de que o servidor está rodando (<code>bun run server</code>) e acesse diretamente pelo IP local: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-amber-200">http://192.168.1.138:5173</code> (para evitar o bloqueio de Mixed Content do Chrome em páginas HTTPS).
            </p>
          </div>
        </div>
      )}

      {/* Main Grid: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Este Dispositivo */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-6 backdrop-blur-xl shadow-xl shadow-black/40">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Este Dispositivo</span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Pronto para Conexões
              </span>
            </div>

            {/* 9-Digit ID Display */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 mb-6 text-center relative overflow-hidden group">
              <div className="text-xs text-slate-400 mb-1">Seu ID de Acesso</div>
              <div
                data-testid="device-id-display"
                className="text-3xl font-extrabold font-mono tracking-wider text-cyan-400 selection:bg-cyan-500/40"
              >
                {deviceId ? formatDeviceId(deviceId) : "Obtendo ID..."}
              </div>

              <button
                data-testid="copy-id-btn"
                onClick={handleCopyId}
                disabled={!deviceId}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-medium text-slate-200 transition-all border border-slate-700"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-300" />
                    <span>Copiar ID</span>
                  </>
                )}
              </button>
            </div>

            {/* Unattended Access Password Setting */}
            <div className="space-y-3 pb-6 border-b border-slate-800">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Shield className="w-4 h-4 text-cyan-400" />
                <span>Acesso Desassistido (Zero-Trust)</span>
              </div>
              <p className="text-xs text-slate-400">
                Defina uma senha para conectar a este computador remotamente sem necessidade de aprovação manual no local.
              </p>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                  <KeyRound className="w-4 h-4" />
                </div>
                <input
                  data-testid="unattended-password-input"
                  type={showPassword ? "text" : "password"}
                  value={unattendedPassword}
                  onChange={(e) => onUpdateUnattendedPassword(e.target.value)}
                  placeholder="Definir senha de acesso desassistido..."
                  className="w-full pl-9 pr-10 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Default ACL Permissions */}
            <div className="pt-6 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                Permissões Padrão de Host (ACL)
              </span>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 cursor-pointer hover:bg-slate-800/40 transition">
                  <input
                    type="checkbox"
                    checked={defaultAcl.allowInput}
                    onChange={(e) => onUpdateDefaultAcl({ allowInput: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <MousePointer className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-slate-200">Mouse/Teclado</span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 cursor-pointer hover:bg-slate-800/40 transition">
                  <input
                    type="checkbox"
                    checked={defaultAcl.allowClipboard}
                    onChange={(e) => onUpdateDefaultAcl({ allowClipboard: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <Clipboard className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-slate-200">Área de Transf.</span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 cursor-pointer hover:bg-slate-800/40 transition">
                  <input
                    type="checkbox"
                    checked={defaultAcl.allowFileTransfer}
                    onChange={(e) => onUpdateDefaultAcl({ allowFileTransfer: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <FolderSync className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-slate-200">Arquivos</span>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 cursor-pointer hover:bg-slate-800/40 transition">
                  <input
                    type="checkbox"
                    checked={defaultAcl.allowAudio}
                    onChange={(e) => onUpdateDefaultAcl({ allowAudio: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-slate-200">Áudio</span>
                </label>
              </div>

              {/* Stream Capture Mode Selection */}
              <div className="pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Modo de Transmissão de Tela
                  </span>
                  {useSyntheticStream && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      Anti-Espelho Ativo
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onToggleSyntheticStream?.(false)}
                    className={`p-2.5 rounded-lg border text-left transition ${!useSyntheticStream ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-300" : "bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-800/40"}`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5" />
                      Tela Real
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Controlar 2 PCs diferentes</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleSyntheticStream?.(true)}
                    className={`p-2.5 rounded-lg border text-left transition ${useSyntheticStream ? "bg-cyan-500/10 border-cyan-500/40 text-cyan-300" : "bg-slate-950/40 border-slate-800 text-slate-400 hover:bg-slate-800/40"}`}
                  >
                    <div className="font-semibold flex items-center gap-1.5">
                      <FlaskConical className="w-3.5 h-3.5 text-amber-400" />
                      Simulação (1 PC)
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Evita espelho infinito em testes</div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Conectar a Outro Dispositivo */}
        <div className="lg:col-span-7 space-y-6">
          {/* Connection Input Card */}
          <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-6 backdrop-blur-xl shadow-xl shadow-black/40">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-4">
              Conectar a Outro Dispositivo
            </span>

            <form onSubmit={handleSubmitConnect} className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Laptop className="w-5 h-5" />
                  </div>
                  <input
                    data-testid="remote-id-input"
                    type="text"
                    value={remoteInput ? formatDeviceId(remoteInput) : ""}
                    onChange={handleRemoteInputChange}
                    placeholder="Digite o ID de 9 dígitos (XXX XXX XXX)..."
                    className="w-full pl-11 pr-4 py-3 rounded-xl bg-slate-950/80 border border-slate-800 text-lg font-mono font-medium tracking-wider text-white placeholder:text-slate-500 placeholder:text-sm placeholder:font-sans focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                  />
                </div>

                <button
                  data-testid="connect-button"
                  type="submit"
                  disabled={remoteInput.length < 9 || isConnecting}
                  className="px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-white shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 active:scale-98 transition-all"
                >
                  {isConnecting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      <span>Conectando...</span>
                    </>
                  ) : (
                    <>
                      <span>Conectar</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Recent & Favorite Sessions */}
          <div className="bg-slate-900/70 border border-slate-800/90 rounded-2xl p-6 backdrop-blur-xl shadow-xl shadow-black/40">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Sessões Recentes & Favoritos
              </span>
              <span className="text-xs text-slate-500">{recentSessions.length} salvos</span>
            </div>

            {recentSessions.length === 0 ? (
              <div className="py-10 text-center text-slate-500 border border-dashed border-slate-800/80 rounded-xl">
                <Laptop className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhuma sessão recente registrada.</p>
                <p className="text-xs text-slate-600 mt-1">Conecte-se a outro dispositivo para adicionar à lista.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                {recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between group transition-all"
                  >
                    <div
                      className="cursor-pointer flex-1 min-w-0"
                      onClick={() => onConnect(session.id)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2 h-2 rounded-full bg-slate-500 group-hover:bg-cyan-400 transition" />
                        <h4 className="text-sm font-semibold text-slate-200 truncate group-hover:text-cyan-300 transition">
                          {session.name}
                        </h4>
                      </div>
                      <div className="text-xs font-mono text-slate-400">
                        {formatDeviceId(session.id)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition">
                      <button
                        onClick={() => onToggleFavorite(session.id)}
                        className={`p-1.5 rounded-lg hover:bg-slate-800 transition ${session.favorite ? "text-amber-400" : "text-slate-500 hover:text-slate-300"}`}
                        title="Favorito"
                      >
                        <Star className={`w-4 h-4 ${session.favorite ? "fill-amber-400" : ""}`} />
                      </button>
                      <button
                        onClick={() => onRemoveRecent(session.id)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                        title="Remover"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
