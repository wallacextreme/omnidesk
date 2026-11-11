import React, { useRef, useState } from "react";
import { X, UploadCloud, File, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react";
import type { FileTransferProgress } from "../core/file-transfer";

interface ReceivedFileItem {
  name: string;
  size: number;
  blob: Blob;
  sha256: string;
}

interface FileTransferDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeProgress: FileTransferProgress | null;
  onSendFile: (file: File) => void;
  receivedFiles: ReceivedFileItem[];
}

export const FileTransferDrawer: React.FC<FileTransferDrawerProps> = ({
  isOpen,
  onClose,
  activeProgress,
  onSendFile,
  receivedFiles,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  if (!isOpen) return null;

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onSendFile(e.dataTransfer.files[0]);
    }
  };

  const handleDownloadReceived = (file: ReceivedFileItem) => {
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-80 sm:w-96 bg-slate-900/95 border-l border-slate-800 backdrop-blur-2xl z-50 flex flex-col shadow-2xl animate-slide-left">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <UploadCloud className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-bold text-white">Transferência de Arquivos</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Drag & Drop Upload Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition ${isDragOver ? "border-cyan-400 bg-cyan-500/10" : "border-slate-700 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-800/20"}`}
        >
          <UploadCloud className="w-10 h-10 text-cyan-400 mb-2 opacity-80" />
          <p className="text-xs font-semibold text-slate-200">Arraste arquivos aqui ou clique</p>
          <p className="text-[10px] text-slate-500 mt-1">Envio seguro P2P em chunks de 64KB com hash SHA-256</p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                onSendFile(e.target.files[0]);
              }
            }}
          />
        </div>

        {/* Active Transfer Progress */}
        {activeProgress && (
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 truncate">
                <File className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-200 truncate">
                  {activeProgress.fileName}
                </span>
              </div>
              <span className="text-[10px] font-mono text-cyan-400">
                {activeProgress.progressPercent}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-200"
                style={{ width: `${activeProgress.progressPercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>{(activeProgress.transferredBytes / (1024 * 1024)).toFixed(1)} / {(activeProgress.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
              <span>{activeProgress.speedMBps} MB/s</span>
              <span>ETA: {activeProgress.etaSeconds}s</span>
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              {activeProgress.status === "transferring" && (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                  <span className="text-cyan-400">Transmitindo via WebRTC...</span>
                </>
              )}
              {activeProgress.status === "verifying" && (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  <span className="text-amber-400">Verificando SHA-256...</span>
                </>
              )}
              {activeProgress.status === "completed" && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Concluído e Verificado!</span>
                </>
              )}
              {activeProgress.status === "failed" && (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-400">{activeProgress.error || "Falha na transferência"}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Received Files */}
        <div className="space-y-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
            Arquivos Recebidos ({receivedFiles.length})
          </span>

          {receivedFiles.length === 0 ? (
            <p className="text-xs text-slate-600 italic">Nenhum arquivo recebido nesta sessão.</p>
          ) : (
            <div className="space-y-2">
              {receivedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-200 truncate">{file.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {(file.size / (1024 * 1024)).toFixed(2)} MB • SHA-256 verificado
                    </p>
                  </div>
                  <button
                    onClick={() => handleDownloadReceived(file)}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-300 transition shrink-0"
                    title="Baixar Arquivo"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
