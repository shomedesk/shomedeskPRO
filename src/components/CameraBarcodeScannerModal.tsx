import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { 
  Camera, 
  X, 
  Flashlight, 
  RefreshCw, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  ShieldAlert,
  HelpCircle,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

interface CameraBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  title?: string;
}

export function CameraBarcodeScannerModal({
  isOpen,
  onClose,
  onScan,
  title = 'Scan Product Barcode',
}: CameraBarcodeScannerModalProps) {
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('environment');
  const [isScanning, setIsScanning] = useState(false);
  const [isLoadingCamera, setIsLoadingCamera] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showHelpGuide, setShowHelpGuide] = useState(false);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isStartingRef = useRef(false);
  const nativeDetectLoopRef = useRef<boolean>(false);
  const lastScannedTimeRef = useRef<number>(0);

  // Check if running inside iframe (e.g. AI Studio preview)
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  // Play audio beep upon successful scan
  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // 880 Hz standard POS beep
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // Audio not permitted or supported
    }

    // Haptic vibration feedback on mobile
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([70, 30, 70]);
    }
  };

  // Supported standard retail barcodes & QR
  const formatsToSupport = [
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.CODABAR,
  ];

  // Stop scanner safely
  const stopScanner = async () => {
    nativeDetectLoopRef.current = false;
    if (html5QrCodeRef.current) {
      const scanner = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch (err) {
        console.warn('Error stopping scanner:', err);
      } finally {
        try {
          scanner.clear();
        } catch {}
      }
    }
    setIsScanning(false);
    setIsLoadingCamera(false);
    setTorchOn(false);
  };

  // Start scanner with active camera config (with hardware BarcodeDetector and HD resolution)
  const startScanner = async (cameraIdOrMode: string = selectedCameraId) => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    nativeDetectLoopRef.current = false;
    setIsLoadingCamera(true);
    setErrorMsg(null);
    setIsPermissionDenied(false);

    try {
      await stopScanner();

      // Check if mediaDevices exists
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('NOT_SUPPORTED');
      }

      // Initialize Html5Qrcode with hardware BarcodeDetector acceleration enabled
      const html5QrCode = new Html5Qrcode('camera-reader-viewport', {
        formatsToSupport,
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
      });
      html5QrCodeRef.current = html5QrCode;

      // Optimized wide viewfinder bounding box for retail 1D barcodes
      const config = {
        fps: 20,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const width = Math.min(viewfinderWidth * 0.95, 360);
          const height = Math.min(viewfinderHeight * 0.65, 220);
          return {
            width: Math.max(200, Math.floor(width)),
            height: Math.max(120, Math.floor(height)),
          };
        },
        aspectRatio: 1.333333,
        disableFlip: false,
      };

      const scanSuccessCallback = (decodedText: string) => {
        handleSuccessfulScan(decodedText);
      };

      const scanFailureCallback = () => {
        // Normal frame tick (no barcode in frame)
      };

      // Request High-Definition resolution so fine barcode lines are sharp and clear
      let primaryConfig: any = (cameraIdOrMode === 'environment' || !cameraIdOrMode)
        ? {
            facingMode: 'environment',
            width: { min: 1280, ideal: 1920 },
            height: { min: 720, ideal: 1080 },
          }
        : { deviceId: { exact: cameraIdOrMode } };

      let started = false;

      try {
        await html5QrCode.start(
          primaryConfig,
          config,
          scanSuccessCallback,
          scanFailureCallback
        );
        started = true;
      } catch (primaryErr: any) {
        const primName = primaryErr?.name || '';
        const primMsg = primaryErr?.message || String(primaryErr || '');

        // If HD resolution or environment back-camera failed, fallback to standard mode
        console.info('Primary camera start failed, attempting standard fallback:', primName, primMsg);
        try {
          await html5QrCode.start(
            { facingMode: 'environment' },
            config,
            scanSuccessCallback,
            scanFailureCallback
          );
          started = true;
        } catch {
          // If environment mode is not present (e.g. desktop/laptop webcam), fallback to user webcam
          try {
            await html5QrCode.start(
              { facingMode: 'user' },
              config,
              scanSuccessCallback,
              scanFailureCallback
            );
            started = true;
            setSelectedCameraId('user');
          } catch (finalErr) {
            throw finalErr;
          }
        }
      }

      if (started) {
        setIsScanning(true);
        setIsLoadingCamera(false);
        setErrorMsg(null);
        setIsPermissionDenied(false);

        // Start native GPU-accelerated BarcodeDetector frame loop if supported
        startNativeBarcodeDetectorLoop();

        // Query available camera devices in background to populate switch button
        try {
          const devices = await Html5Qrcode.getCameras();
          if (devices && devices.length > 0) {
            setCameras(devices);
          }
        } catch {
          // Ignore enumeration failure
        }

        // Check if torch/flashlight is supported
        try {
          const capabilities = (html5QrCode as any).getRunningTrackCapabilities?.();
          if (capabilities && 'torch' in capabilities) {
            setHasTorch(true);
          }
        } catch {
          setHasTorch(false);
        }
      }

    } catch (err: any) {
      setIsScanning(false);
      setIsLoadingCamera(false);
      const name = err?.name || '';
      const msg = err?.message || String(err || '');

      console.warn('Camera scanner initialization notice:', name, msg);

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('Permission denied') || msg.includes('Permission dismissed')) {
        setIsPermissionDenied(true);
        setErrorMsg('Camera permission was blocked. Browser security prevented live camera access.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || msg.includes('Requested device not found') || msg === 'NOT_SUPPORTED') {
        setIsPermissionDenied(false);
        setErrorMsg('No camera hardware found on this device.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setIsPermissionDenied(false);
        setErrorMsg('Camera is currently in use by another tab or app. Please close other camera tabs and retry.');
      } else {
        setIsPermissionDenied(false);
        setErrorMsg('Unable to initialize live video stream. You can take a photo or type the barcode directly.');
      }
    } finally {
      isStartingRef.current = false;
    }
  };

  // Run native hardware BarcodeDetector directly on the active <video> element for 50x faster detection
  const startNativeBarcodeDetectorLoop = () => {
    if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return;

    try {
      const nativeDetector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf']
      });

      nativeDetectLoopRef.current = true;

      const detectFrame = async () => {
        if (!nativeDetectLoopRef.current || !html5QrCodeRef.current) return;

        const videoEl = document.querySelector('#camera-reader-viewport video') as HTMLVideoElement | null;
        if (videoEl && videoEl.readyState >= 2) {
          try {
            const detected = await nativeDetector.detect(videoEl);
            if (detected && detected.length > 0 && detected[0].rawValue) {
              handleSuccessfulScan(detected[0].rawValue);
              return;
            }
          } catch {
            // Frame detection tick
          }
        }

        if (nativeDetectLoopRef.current) {
          requestAnimationFrame(detectFrame);
        }
      };

      requestAnimationFrame(detectFrame);
    } catch {
      // Native detector fallback
    }
  };

  // Explicit user-gesture request for camera permission
  const handleRequestPermission = async () => {
    setIsLoadingCamera(true);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        toast.error('MediaDevices API not supported on this browser.');
        setIsLoadingCamera(false);
        return;
      }

      // Explicitly prompt for permission via user click gesture
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true
      });

      // Release immediately and start html5QrCode
      stream.getTracks().forEach(track => track.stop());
      toast.success('Camera permission granted! Starting scanner...');
      setIsPermissionDenied(false);
      setErrorMsg(null);
      await startScanner('environment');
    } catch (err: any) {
      console.warn('Direct getUserMedia request notice:', err);
      setIsLoadingCamera(false);
      setIsPermissionDenied(true);
      toast.error('Camera access still blocked. Please allow Camera in browser address bar (🔒).');
    }
  };

  // Open in new tab (bypasses iframe sandbox camera restrictions)
  const handleOpenInNewTab = () => {
    try {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    } catch {
      toast.info('Please open the URL in a direct browser tab for full camera permissions.');
    }
  };

  // Initialize camera when modal opens
  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      return;
    }

    setErrorMsg(null);
    setIsPermissionDenied(false);
    setLastScannedCode(null);

    // Give DOM a frame to render the viewport div
    const timer = setTimeout(() => {
      startScanner(selectedCameraId);
    }, 150);

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
  }, [isOpen]);

  // Handle successful barcode scan with debounce to prevent duplicate firing
  const handleSuccessfulScan = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    const now = Date.now();
    // Debounce duplicate scans within 1.5 seconds
    if (trimmed === lastScannedCode && now - lastScannedTimeRef.current < 1500) {
      return;
    }

    lastScannedTimeRef.current = now;
    playBeep();
    setLastScannedCode(trimmed);
    onScan(trimmed);
    toast.success(`Scanned Barcode: ${trimmed}`);
  };

  // Toggle flashlight / torch
  const toggleTorch = async () => {
    if (!html5QrCodeRef.current || !hasTorch) return;
    try {
      const nextState = !torchOn;
      await (html5QrCodeRef.current as any).applyVideoConstraints({
        advanced: [{ torch: nextState }]
      });
      setTorchOn(nextState);
    } catch (err) {
      console.warn('Torch toggle notice:', err);
    }
  };

  // Switch between available cameras
  const switchCamera = async () => {
    if (cameras.length <= 1) return;
    const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextId = cameras[nextIndex].id;
    setSelectedCameraId(nextId);
    await startScanner(nextId);
  };

  // Native phone camera photo capture fallback with dual hardware detector + ZXing scan
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const toastId = toast.loading('Decoding barcode from photo...');
    try {
      // 1. Try native hardware BarcodeDetector first (lightning fast on Android/Chrome)
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const nativeDetector = new (window as any).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf']
          });
          const bitmap = await createImageBitmap(file);
          const barcodes = await nativeDetector.detect(bitmap);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            toast.dismiss(toastId);
            handleSuccessfulScan(barcodes[0].rawValue);
            onClose();
            return;
          }
        } catch {
          // Continue to html5-qrcode fallback
        }
      }

      // 2. Fallback to html5-qrcode ZXing file scanner
      const scanner = new Html5Qrcode('camera-reader-viewport-file-temp', {
        formatsToSupport,
        verbose: false,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
      });

      const decodedResult = await scanner.scanFile(file, true);
      try {
        scanner.clear();
      } catch {}

      toast.dismiss(toastId);
      handleSuccessfulScan(decodedResult);
      onClose();
    } catch (err: any) {
      console.warn('Scan file error:', err);
      toast.error('Could not detect barcode. Please hold camera closer with good light and snap again.', { id: toastId });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col relative my-auto animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-slate-950/90">
          <div className="flex items-center gap-2.5 text-blue-400">
            <div className="p-2 bg-blue-500/10 rounded-xl">
              <Camera size={18} />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                {title}
              </h3>
              <p className="text-[10px] text-slate-400 font-medium">
                Hold product barcode inside scanner box
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
            title="Close Scanner"
          >
            <X size={18} />
          </button>
        </div>

        {/* Camera Viewport Container */}
        <div className="relative bg-black flex flex-col items-center justify-center min-h-[320px] overflow-hidden">
          
          {/* html5-qrcode video viewport */}
          <div 
            id="camera-reader-viewport" 
            className="w-full aspect-[4/3] max-h-[360px] overflow-hidden flex items-center justify-center"
          />
          {/* Hidden helper for file scanning */}
          <div id="camera-reader-viewport-file-temp" className="hidden" />

          {/* Loading Camera Spinner */}
          {isLoadingCamera && !errorMsg && (
            <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center space-y-3 z-10">
              <div className="w-9 h-9 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-bold text-slate-300">
                Starting Camera Feed...
              </p>
            </div>
          )}

          {/* Active Scanner Laser & Box Overlay */}
          {isScanning && !errorMsg && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
              <div className="relative w-72 h-44 rounded-2xl border-2 border-dashed border-blue-400/80 shadow-[0_0_20px_rgba(59,130,246,0.3)] flex items-center justify-center overflow-hidden">
                {/* Corner targets */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
                
                {/* Animated Horizontal Scan Laser */}
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse animate-bounce" />
              </div>
              <p className="mt-3 text-[11px] font-bold text-white bg-black/70 px-3 py-1 rounded-full backdrop-blur-sm shadow border border-white/10">
                Align barcode within box
              </p>
            </div>
          )}

          {/* Camera Permission / Error Resolution State */}
          {errorMsg && (
            <div className="absolute inset-0 bg-slate-900/98 flex flex-col items-center justify-center p-5 text-center space-y-3 z-20 overflow-y-auto">
              <div className="p-3 bg-rose-500/10 text-rose-400 rounded-2xl border border-rose-500/20 shrink-0">
                {isPermissionDenied ? <ShieldAlert size={28} /> : <AlertCircle size={28} />}
              </div>

              <div>
                <h4 className="text-sm font-black text-white">
                  {isPermissionDenied ? 'Camera Permission Required' : 'Camera Feed Notice'}
                </h4>
                <p className="text-xs text-slate-300 mt-1 max-w-xs leading-relaxed">
                  {errorMsg}
                </p>
                {isInIframe && isPermissionDenied && (
                  <p className="text-[11px] text-amber-300/90 mt-1.5 max-w-xs">
                    Embedded preview frames block live camera. Open in a standalone tab or take a quick photo below.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 w-full max-w-xs pt-1">
                {/* 1. Instant Phone Camera Photo Fallback (100% Reliable, works on any phone) */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition-all active:scale-95 cursor-pointer shadow-lg shadow-blue-900/40"
                >
                  <Upload size={15} />
                  <span>Take / Upload Barcode Photo</span>
                </button>

                {/* 2. Open in Dedicated Tab (if in iframe preview) */}
                {isInIframe && (
                  <button
                    type="button"
                    onClick={handleOpenInNewTab}
                    className="flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-2 px-3 rounded-xl text-xs transition-all cursor-pointer shadow-md shadow-emerald-950/30"
                  >
                    <ExternalLink size={14} />
                    <span>Open in Standalone Tab</span>
                  </button>
                )}

                {/* 3. Explicit Permission Request button */}
                {isPermissionDenied && (
                  <button
                    type="button"
                    onClick={handleRequestPermission}
                    disabled={isLoadingCamera}
                    className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 px-3 rounded-xl text-xs transition-all cursor-pointer border border-slate-700"
                  >
                    <Camera size={14} />
                    <span>Grant Camera Permission</span>
                  </button>
                )}

                {/* 4. Manual Barcode Entry Fallback */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (manualBarcode.trim()) {
                      handleSuccessfulScan(manualBarcode.trim());
                      setManualBarcode('');
                    }
                  }}
                  className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-1 mt-1"
                >
                  <input
                    type="text"
                    placeholder="Or type barcode here..."
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    className="flex-1 bg-transparent text-xs text-white px-2.5 py-1.5 outline-none font-mono"
                  />
                  <button
                    type="submit"
                    disabled={!manualBarcode.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-[11px] px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                  >
                    Add
                  </button>
                </form>

                {/* 5. Retry / Step-by-step Help Toggle */}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => startScanner('environment')}
                    className="flex items-center gap-1 text-slate-400 hover:text-slate-200 text-[11px] font-medium py-1 transition-colors cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>Retry Camera</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowHelpGuide(!showHelpGuide)}
                    className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-[11px] font-medium py-1 transition-colors cursor-pointer"
                  >
                    <HelpCircle size={12} />
                    <span>How to enable camera?</span>
                  </button>
                </div>

                {/* Permission instructions guide */}
                {showHelpGuide && (
                  <div className="bg-slate-950/90 border border-slate-800 p-3 rounded-xl text-left text-[11px] text-slate-300 space-y-1.5 mt-1 animate-in fade-in">
                    <p className="font-bold text-white text-[11px]">Browser Permissions:</p>
                    <p>1. In the browser address bar, click the <strong>🔒 Lock icon</strong> or Site Settings.</p>
                    <p>2. Set <strong>Camera</strong> to <strong>&quot;Allow&quot;</strong>.</p>
                    <p>3. Reload this page or use the <strong>&quot;Take / Upload Barcode Photo&quot;</strong> button above.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Flash Scanned Result Banner */}
          {lastScannedCode && (
            <div className="absolute top-3 left-3 right-3 bg-emerald-500/95 text-white p-2.5 rounded-xl shadow-lg flex items-center justify-between text-xs font-bold backdrop-blur-sm animate-in fade-in slide-in-from-top-2 z-30">
              <div className="flex items-center gap-2 truncate">
                <CheckCircle2 size={16} className="text-white shrink-0" />
                <span className="truncate">Scanned: {lastScannedCode}</span>
              </div>
              <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase">Success</span>
            </div>
          )}
        </div>

        {/* Scanner Controls Toolbar */}
        <div className="p-4 bg-slate-950/95 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            {/* Flashlight toggle */}
            {hasTorch ? (
              <button
                type="button"
                onClick={toggleTorch}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                  torchOn 
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                <Flashlight size={14} />
                <span>{torchOn ? 'Torch On' : 'Torch'}</span>
              </button>
            ) : <div />}

            {/* Switch Camera Button (if multiple cameras available) */}
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-all cursor-pointer"
                title="Switch Camera (Front/Back)"
              >
                <RefreshCw size={14} />
                <span>Switch Cam</span>
              </button>
            )}

            {/* Photo / Image File Upload (100% Reliable Native Mobile Camera Fallback) */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 transition-all cursor-pointer ml-auto"
              title="Take photo using phone camera app"
            >
              <Upload size={14} />
              <span>Capture Photo</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500 border-t border-slate-800/60">
            <span>Supports EAN-13, Code 128, UPC, QR</span>
            <button
              type="button"
              onClick={() => {
                stopScanner();
                onClose();
              }}
              className="text-slate-400 hover:text-white font-bold underline cursor-pointer"
            >
              Done & Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
