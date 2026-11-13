import React, { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[OmniDesk] Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#090d16] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-slate-900 border border-rose-500/30 rounded-2xl p-8 shadow-2xl shadow-rose-950/20 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 text-2xl font-bold">
              !
            </div>
            <h1 className="text-xl font-bold text-white mb-2">OmniDesk - Diagnóstico de Inicialização</h1>
            <p className="text-sm text-slate-400 mb-4">
              Ocorreu um erro ao carregar componentes no seu navegador. Isso pode ocorrer no Windows 7 ou versões anteriores do Chrome (v109 ou menor).
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-left mb-6 overflow-auto max-h-40">
              <code className="text-xs text-rose-300 font-mono break-all">
                {this.state.error?.message || String(this.state.error)}
              </code>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-all shadow-lg shadow-cyan-500/20 cursor-pointer"
              >
                Recarregar Página
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
