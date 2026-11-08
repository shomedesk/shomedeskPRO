import React, { useState, useEffect } from 'react';
import { 
  Printer, 
  Bluetooth, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  X, 
  Sparkles, 
  HelpCircle,
  Smartphone,
  Laptop
} from 'lucide-react';
import { 
  connectBluetoothPrinter, 
  disconnectBluetoothPrinter, 
  isBluetoothSupported, 
  getPrinterStatus, 
  subscribePrinterState, 
  printTestSlipViaBluetooth 
} from '@/src/lib/bluetoothPrinter';
import { toast } from 'sonner';

interface BluetoothPrinterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BluetoothPrinterModal({ isOpen, onClose }: BluetoothPrinterModalProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const supported = isBluetoothSupported();

  useEffect(() => {
    const unsub = subscribePrinterState((conn, name) => {
      setIsConnected(conn);
      setDeviceName(name);
    });
    return unsub;
  }, []);

  if (!isOpen) return null;

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await connectBluetoothPrinter();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnectBluetoothPrinter();
  };

  const handleTestPrint = async () => {
    setIsTesting(true);
    try {
      await printTestSlipViaBluetooth();
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-2xl">
              <Bluetooth size={20} className={isConnected ? "text-emerald-400" : ""} />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-100 uppercase tracking-wide flex items-center gap-2">
                Bluetooth Printer (58mm)
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  POS Mini
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Direct wireless printing from browser to 58mm thermal receipt printers
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-5 text-xs text-slate-300">
          
          {/* Status Box */}
          <div className={`p-4 rounded-2xl border transition-all ${
            isConnected 
              ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200" 
              : "bg-slate-950/60 border-slate-800 text-slate-300"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                <div>
                  <p className="font-black text-sm text-slate-100">
                    {isConnected ? (deviceName || '58mm Bluetooth Printer') : 'No Printer Connected'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {isConnected ? 'Ready for 1-click wireless printing (58mm roll, 32 cols)' : 'Scan and pair your mini Bluetooth POS thermal printer'}
                  </p>
                </div>
              </div>
              {isConnected && (
                <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  Online
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2.5">
            {!isConnected ? (
              <button
                type="button"
                onClick={handleConnect}
                disabled={isConnecting}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-2xl shadow-lg shadow-blue-900/30 transition-all cursor-pointer active:scale-95"
              >
                {isConnecting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Searching Bluetooth Devices...</span>
                  </>
                ) : (
                  <>
                    <Bluetooth size={16} />
                    <span>Connect 58mm Bluetooth Printer</span>
                  </>
                )}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleTestPrint}
                  disabled={isTesting}
                  className="flex items-center justify-center gap-2 py-3 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black rounded-2xl shadow-lg shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
                >
                  <Printer size={15} className={isTesting ? "animate-bounce" : ""} />
                  <span>{isTesting ? 'Printing...' : 'Print Test Slip'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="flex items-center justify-center gap-1.5 py-3 px-3 bg-slate-800 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-500/40 text-xs font-bold rounded-2xl transition-all cursor-pointer active:scale-95"
                >
                  <X size={15} />
                  <span>Disconnect</span>
                </button>
              </div>
            )}
          </div>

          {/* Setup & Direct Print Guidance */}
          <div className="bg-slate-950/40 p-4 rounded-2xl border border-slate-800 space-y-2.5">
            <div className="flex items-center gap-2 text-blue-400 font-black text-xs uppercase tracking-wider">
              <HelpCircle size={15} />
              <span>How Direct Printing Works in This App</span>
            </div>
            <ul className="space-y-1.5 text-[11px] text-slate-400 leading-relaxed list-disc list-inside">
              <li>
                <strong className="text-slate-200">Bluetooth Direct Print:</strong> In Chrome or Android browsers, click <em>Connect 58mm Bluetooth Printer</em>, select your printer (MPT-II, POS-58, etc.), and pair. Every PO and bill will print wirelessly in 1 second!
              </li>
              <li>
                <strong className="text-slate-200">1-Click Browser Print (58mm):</strong> If Bluetooth is not paired, you can click <em>Direct Print (58mm)</em> on any PO to open your system print dialog formatted specifically for 58mm receipt rolls without downloading files.
              </li>
              <li>
                <strong className="text-slate-200">58mm PDF Download:</strong> You also have the <em>58mm PDF</em> download button tailored for 58mm paper rolls.
              </li>
            </ul>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-slate-400 text-[11px]">
          <span>Paper Size: <strong className="text-white font-mono">58mm (32 Columns)</strong></span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
