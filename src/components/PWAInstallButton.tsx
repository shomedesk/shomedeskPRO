import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { usePWAInstall } from '@/src/hooks/usePWAInstall';
import { 
  Download, 
  Smartphone, 
  X, 
  Check, 
  Apple, 
  Monitor, 
  ExternalLink, 
  Sparkles,
  Zap,
  Layers,
  ArrowRight
} from 'lucide-react';
import { toast } from 'sonner';

export const PWAInstallButton: React.FC<{ className?: string }> = ({ 
  className = '' 
}) => {
  const { 
    isInstallable, 
    isInstalled, 
    isIOS, 
    isAndroid, 
    isIframe, 
    browserName, 
    hasPrompt, 
    install 
  } = usePWAInstall();

  const [showGuideModal, setShowGuideModal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // 1. If currently running as an installed PWA (in standalone mode), AUTOMATICALLY HIDE
  // When the user uninstalls and opens in normal browser, isInstalled will be false and it automatically reappears!
  if (isInstalled) {
    return null;
  }

  // Handle click on the header install button
  const handleButtonClick = async () => {
    // If the browser already has the native prompt ready (Chromium / Android Chrome)
    if (hasPrompt) {
      setIsInstalling(true);
      try {
        const result = await install();
        if (result.success) {
          toast.success('🎉 ShomeDesk installed successfully to your device!');
          setShowGuideModal(false);
          return;
        } else if (result.outcome === 'dismissed') {
          toast.info('Installation cancelled. You can install anytime from this button.');
          return;
        }
      } catch (err) {
        console.warn('Install error:', err);
      } finally {
        setIsInstalling(false);
      }
    }

    // If native prompt is not available yet (e.g. iframe preview, iOS Safari, or desktop Chrome waiting for user action)
    // Open the visual install assistant modal
    setShowGuideModal(true);
  };

  const handleOpenInNewTab = () => {
    // Opens current app in a fresh top-level browser tab where browser allows native PWA installation
    window.open(window.location.href, '_blank');
  };

  return (
    <>
      {/* Prominent Header Install Button */}
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={isInstalling}
        className={`group flex items-center gap-1.5 sm:gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs font-black shadow-lg shadow-blue-900/30 transition-all cursor-pointer active:scale-95 border border-blue-400/30 shrink-0 ${className}`}
        title="Install ShomeDesk as Native App on PC or Mobile"
      >
        <Download size={14} className="text-white group-hover:translate-y-0.5 transition-transform shrink-0" />
        <span className="inline">Install App</span>
        <span className="hidden md:inline-flex items-center px-1.5 py-0.2 rounded-md bg-white/20 text-[9px] font-black uppercase tracking-wider">
          PWA
        </span>
      </button>

      {/* Interactive PWA Install Guide & Assistant Modal */}
      {showGuideModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col relative my-auto">
            
            {/* Header with App Branding */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center gap-3">
                <img 
                  src="/pwa-192x192.png" 
                  alt="ShomeDesk Icon" 
                  className="w-10 h-10 rounded-2xl shadow-md border border-slate-700/60 object-cover bg-slate-950" 
                  onError={(e) => {
                    // Fallback to favicon
                    (e.currentTarget as HTMLImageElement).src = '/favicon.png';
                  }}
                />
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-1.5">
                    Install ShomeDesk App
                    <Sparkles size={14} className="text-amber-400" />
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    Native desktop & mobile home screen experience
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto text-slate-200">
              
              {/* Feature Highlights */}
              <div className="grid grid-cols-3 gap-2 py-1">
                <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-2.5 text-center flex flex-col items-center">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 mb-1">
                    <Zap size={14} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-300">Fast Launch</span>
                  <span className="text-[9px] text-slate-500">Instant start</span>
                </div>

                <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-2.5 text-center flex flex-col items-center">
                  <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 mb-1">
                    <Layers size={14} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-300">Full Screen</span>
                  <span className="text-[9px] text-slate-500">No browser bar</span>
                </div>

                <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-2.5 text-center flex flex-col items-center">
                  <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 mb-1">
                    <Smartphone size={14} />
                  </div>
                  <span className="text-[10px] font-bold text-slate-300">Offline Cache</span>
                  <span className="text-[9px] text-slate-500">Works offline</span>
                </div>
              </div>

              {/* 1-Click Native Install Prompt if available */}
              {hasPrompt && (
                <div className="p-4 bg-gradient-to-r from-blue-950/50 to-indigo-950/50 border border-blue-500/30 rounded-2xl text-center space-y-2">
                  <p className="text-xs text-blue-200 font-medium">
                    Your browser is ready to install the application in 1 click:
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      setIsInstalling(true);
                      const result = await install();
                      setIsInstalling(false);
                      if (result.success) {
                        toast.success('ShomeDesk installed successfully!');
                        setShowGuideModal(false);
                      }
                    }}
                    disabled={isInstalling}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40 cursor-pointer active:scale-95"
                  >
                    <Download size={16} />
                    <span>Click Here to Install Now</span>
                  </button>
                </div>
              )}

              {/* Notice if running inside iframe preview */}
              {isIframe && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
                    <ExternalLink size={15} className="shrink-0" />
                    <span>Embedded Preview Mode</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Browser security prevents native 1-click installation dialogs inside embedded previews. Open the app in its own browser tab to install directly to your device desktop/home screen!
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenInNewTab}
                    className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold py-2 rounded-xl text-xs transition-all border border-slate-700 cursor-pointer"
                  >
                    <span>Open in New Browser Tab</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              )}

              {/* Platform Specific Step-by-Step Instructions */}
              <div className="space-y-3 pt-1">
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                  {isIOS ? 'Install on iPhone / iPad (Safari)' : isAndroid ? 'Install on Android Phone (Chrome)' : 'Install on PC / Mac (Chrome / Edge)'}
                </div>

                {isIOS ? (
                  // iOS Safari Instructions
                  <div className="space-y-2 text-xs">
                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">1</span>
                      <div>
                        <p className="font-bold text-white">Tap the Share button</p>
                        <p className="text-[11px] text-slate-400">Look for the square icon with an upward arrow at the bottom of Safari.</p>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">2</span>
                      <div>
                        <p className="font-bold text-white">Select "Add to Home Screen"</p>
                        <p className="text-[11px] text-slate-400">Scroll down in the share menu and tap the <strong>Add to Home Screen</strong> option.</p>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">3</span>
                      <div>
                        <p className="font-bold text-white">Tap "Add" in Top-Right</p>
                        <p className="text-[11px] text-slate-400">ShomeDesk will appear as a standalone app on your home screen!</p>
                      </div>
                    </div>
                  </div>
                ) : isAndroid ? (
                  // Android Instructions
                  <div className="space-y-2 text-xs">
                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">1</span>
                      <div>
                        <p className="font-bold text-white">Tap Menu (⋮) in Chrome</p>
                        <p className="text-[11px] text-slate-400">Tap the three vertical dots in the top-right corner of Chrome.</p>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">2</span>
                      <div>
                        <p className="font-bold text-white">Tap "Install App" or "Add to Home Screen"</p>
                        <p className="text-[11px] text-slate-400">Select the install option from the menu list.</p>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">3</span>
                      <div>
                        <p className="font-bold text-white">Confirm Installation</p>
                        <p className="text-[11px] text-slate-400">Tap "Install". The app will be placed directly in your app drawer.</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Desktop (Chrome / Edge) Instructions
                  <div className="space-y-2 text-xs">
                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">1</span>
                      <div>
                        <p className="font-bold text-white">Check URL Bar Install Icon</p>
                        <p className="text-[11px] text-slate-400">Click the <strong>Install App icon (💻 or ⊕)</strong> located on the right side of the browser address bar.</p>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-950/70 rounded-2xl border border-slate-800 flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">2</span>
                      <div>
                        <p className="font-bold text-white">Or use Browser Menu (⋮)</p>
                        <p className="text-[11px] text-slate-400">Click the 3 dots in the top-right → tap <strong>"Install ShomeDesk..."</strong> or <strong>"Save and share"</strong> → <strong>"Install page as app"</strong>.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Behavior Note */}
              <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60 text-[10px] text-slate-400 flex items-center gap-2">
                <Check size={14} className="text-emerald-400 shrink-0" />
                <span>Once installed and opened from your home screen or desktop, this install button automatically disappears. If uninstalled, it reappears automatically.</span>
              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/90 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}
    </>
  );
};
