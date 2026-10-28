import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    const msg = error?.message || String(error || '');
    if (msg.includes('Pending promise was never set') || msg.includes('INTERNAL ASSERTION FAILED')) {
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#1E293B] rounded-3xl border border-slate-800 p-8 shadow-2xl text-center space-y-6">
            <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="text-rose-500" size={40} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-50">Something went wrong</h1>
              <p className="text-slate-400 font-medium leading-relaxed">
                An unexpected error occurred. Our team has been notified.
              </p>
            </div>

            {Boolean((import.meta as any)?.env?.DEV) && (
              <div className="bg-slate-900 p-4 rounded-2xl text-left overflow-auto max-h-40 border border-slate-800">
                <p className="text-rose-400 font-mono text-xs break-words">
                  {this.state.error?.toString()}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <RefreshCcw size={20} />
                Reload Application
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-slate-700"
              >
                <Home size={20} />
                Back to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
