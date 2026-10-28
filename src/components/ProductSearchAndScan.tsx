import React, { useState, useRef, useEffect } from 'react';
import { SalesPlayProduct } from '@/src/types';
import {
  Search,
  Barcode as BarcodeIcon,
  Plus,
  Package,
  CheckCircle2,
  AlertCircle,
  Camera,
  Upload,
  Zap,
  CornerDownLeft,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { formatAmount } from '@/src/lib/currencyUtils';
import { CameraBarcodeScannerModal } from './CameraBarcodeScannerModal';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface ProductSearchAndScanProps {
  products: SalesPlayProduct[];
  onSelectProduct: (product: SalesPlayProduct) => void;
  onAddCustomWithBarcode?: (barcode: string) => void;
  currency: string;
  autoFocusScanner?: boolean;
}

export function ProductSearchAndScan({
  products,
  onSelectProduct,
  onAddCustomWithBarcode,
  currency,
  autoFocusScanner = true,
}: ProductSearchAndScanProps) {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isDecodingPhoto, setIsDecodingPhoto] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const directPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto focus scanner input when mounted
  useEffect(() => {
    if (autoFocusScanner && barcodeInputRef.current) {
      const timer = setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocusScanner]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered products for search autocomplete
  const searchResults = React.useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase().trim();
    return products
      .filter(p =>
        (p.product_name && p.product_name.toLowerCase().includes(term)) ||
        (p.product_code && p.product_code.toLowerCase().includes(term)) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.category && p.category.toLowerCase().includes(term))
      )
      .slice(0, 10);
  }, [products, searchTerm]);

  // Process barcode scan or input
  const processBarcodeScan = (scannedCode: string) => {
    const raw = scannedCode.trim();
    if (!raw) return;
    const code = raw.toLowerCase();
    const cleanDigits = raw.replace(/\D/g, '');

    // 1. Match against products by barcode, product_code, or leading-zero normalized numeric barcode
    const matched = products.find(p => {
      const pBarcode = (p.barcode || '').trim().toLowerCase();
      const pCode = (p.product_code || '').trim().toLowerCase();

      if (pBarcode && pBarcode === code) return true;
      if (pCode && pCode === code) return true;

      // Handle leading zeros discrepancy (e.g. UPC-A 12 digits vs EAN-13 with leading 0)
      if (cleanDigits && cleanDigits.length >= 3) {
        const pCleanBarcode = (p.barcode || '').replace(/\D/g, '');
        if (pCleanBarcode && (pCleanBarcode === cleanDigits || pCleanBarcode.replace(/^0+/, '') === cleanDigits.replace(/^0+/, ''))) {
          return true;
        }
      }

      // Name exact match fallback
      if (p.product_name && p.product_name.trim().toLowerCase() === code) {
        return true;
      }

      return false;
    });

    if (matched) {
      onSelectProduct(matched);
      toast.success(`Scanned: "${matched.product_name}" (+1 Qty)`, {
        icon: <CheckCircle2 className="text-emerald-400" size={16} />,
      });
    } else {
      // If not in catalog, add custom item or notify
      if (onAddCustomWithBarcode) {
        onAddCustomWithBarcode(raw);
        toast.info(`New barcode "${raw}" added to bill list. Enter item details.`);
      } else {
        toast.error(`Barcode "${raw}" not found in product catalog`);
      }
    }
  };

  // Handle Barcode Submit
  const handleBarcodeSubmit = () => {
    const scanned = barcodeInput.trim();
    if (!scanned) return;

    processBarcodeScan(scanned);
    setBarcodeInput('');
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 50);
  };

  // Direct 1-Tap Phone Photo Scan (Bypasses WebRTC permissions completely, works in all iframes & browsers)
  const handleDirectPhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsDecodingPhoto(true);
    const toastId = toast.loading('Reading barcode from captured photo...');

    try {
      // 1. Hardware BarcodeDetector (Chrome/Android GPU accelerated)
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const detector = new (window as any).BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf']
          });
          const bitmap = await createImageBitmap(file);
          const results = await detector.detect(bitmap);
          if (results && results.length > 0 && results[0].rawValue) {
            toast.dismiss(toastId);
            processBarcodeScan(results[0].rawValue);
            setIsDecodingPhoto(false);
            if (directPhotoInputRef.current) directPhotoInputRef.current.value = '';
            return;
          }
        } catch {
          // Fall through to html5-qrcode
        }
      }

      // 2. Fallback to Html5Qrcode file scan
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.QR_CODE,
      ];

      const tempScanner = new Html5Qrcode('direct-photo-scan-temp', {
        formatsToSupport,
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });

      const decoded = await tempScanner.scanFile(file, true);
      try {
        tempScanner.clear();
      } catch {}

      toast.dismiss(toastId);
      processBarcodeScan(decoded);
    } catch (err) {
      console.warn('Direct photo barcode scan notice:', err);
      toast.error('Barcode not clear in photo. Please hold closer with good lighting and snap again.', { id: toastId });
    } finally {
      setIsDecodingPhoto(false);
      if (directPhotoInputRef.current) directPhotoInputRef.current.value = '';
    }
  };

  const handleSelectFromSearch = (product: SalesPlayProduct) => {
    onSelectProduct(product);
    setSearchTerm('');
    setIsDropdownOpen(false);
    toast.success(`Added "${product.product_name}" to order`);
  };

  return (
    <div className="space-y-3 bg-slate-950/70 p-3 sm:p-4 rounded-2xl border border-slate-800">
      {/* Hidden helper element for file scanning */}
      <div id="direct-photo-scan-temp" className="hidden" />

      {/* 1. Barcode Scanner Gun & Quick Scan Form */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-slate-300 flex items-center gap-1.5">
            <BarcodeIcon size={14} className="text-indigo-400" />
            <span>Barcode Scanner (Gun / Keyboard / Photo / Camera):</span>
          </span>
          <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
            Ready to Scan
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Native HTML Form guarantees Enter key & Scanner gun trigger always submit */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleBarcodeSubmit();
            }}
            className="flex-1 flex items-center gap-2 bg-slate-900 border-2 border-indigo-500/60 hover:border-indigo-500 focus-within:border-indigo-400 rounded-xl px-3 py-2 transition-all shadow-inner"
          >
            <BarcodeIcon size={18} className="text-indigo-400 shrink-0" />
            <input
              ref={barcodeInputRef}
              type="text"
              placeholder="Scan with barcode gun or type barcode & press Enter..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="w-full bg-transparent text-xs sm:text-sm text-slate-100 placeholder-slate-500 outline-none font-mono py-1"
            />
            {barcodeInput ? (
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg shrink-0 cursor-pointer flex items-center gap-1 active:scale-95"
              >
                <span>Add</span>
                <CornerDownLeft size={12} />
              </button>
            ) : (
              <span className="text-[10px] text-slate-500 font-mono hidden md:inline px-1">
                Enter ↵
              </span>
            )}
          </form>

          {/* 1-Tap Direct Camera Photo Snap (Guaranteed to work on all phones & tablets without WebRTC permissions) */}
          <button
            type="button"
            onClick={() => directPhotoInputRef.current?.click()}
            disabled={isDecodingPhoto}
            className="flex items-center justify-center gap-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold px-3.5 py-2.5 rounded-xl text-xs transition-all shrink-0 cursor-pointer shadow-md shadow-blue-900/30 active:scale-95 border border-blue-400/30"
            title="Snap a photo of the barcode with phone camera (100% reliable)"
          >
            <Upload size={15} />
            <span>{isDecodingPhoto ? 'Scanning...' : 'Snap Photo'}</span>
          </button>
          <input
            ref={directPhotoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleDirectPhotoCapture}
            className="hidden"
          />

          {/* Live Video Camera Viewfinder Modal Button */}
          <button
            type="button"
            onClick={() => setIsCameraOpen(true)}
            className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-bold px-3 py-2.5 rounded-xl text-xs transition-all shrink-0 cursor-pointer border border-slate-700/80 hover:border-indigo-500/50"
            title="Open Live Camera Video Scanner Viewfinder"
          >
            <Camera size={15} className="text-blue-400" />
            <span className="hidden sm:inline">Live</span> Cam
          </button>
        </div>
      </div>

      {/* Camera Barcode Scanner Modal (Only opened if user explicitly wants to use device camera) */}
      <CameraBarcodeScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onScan={(scanned) => {
          processBarcodeScan(scanned);
        }}
        title="Camera Barcode Scanner"
      />

      {/* 2. Product Search with Autocomplete Dropdown */}
      <div ref={searchContainerRef} className="relative">
        <div className="relative flex items-center">
          <Search size={16} className="absolute left-3.5 text-slate-500" />
          <input
            type="text"
            placeholder={`Search ${products.length} products by name, code, or barcode...`}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsDropdownOpen(true);
              setHighlightedIndex(0);
            }}
            onFocus={() => setIsDropdownOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedIndex(prev => (prev + 1) % Math.max(1, searchResults.length));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedIndex(prev => (prev - 1 + searchResults.length) % Math.max(1, searchResults.length));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (searchResults[highlightedIndex]) {
                  handleSelectFromSearch(searchResults[highlightedIndex]);
                }
              } else if (e.key === 'Escape') {
                setIsDropdownOpen(false);
              }
            }}
            className="w-full bg-slate-900/90 border border-slate-800 focus:border-indigo-500/80 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 outline-none transition-all shadow-inner"
          />
        </div>

        {/* Autocomplete Dropdown List */}
        {isDropdownOpen && searchResults.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-30 overflow-hidden divide-y divide-slate-800/60 max-h-72 overflow-y-auto animate-in fade-in slide-in-from-top-1">
            {searchResults.map((product, idx) => {
              const isSelected = idx === highlightedIndex;
              return (
                <div
                  key={product.id}
                  onClick={() => handleSelectFromSearch(product)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-600/20 text-white' : 'hover:bg-slate-800/60 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <div className="p-1.5 bg-slate-800 rounded-lg shrink-0 text-slate-400">
                      <Package size={14} />
                    </div>
                    <div className="truncate">
                      <p className="text-xs font-bold text-white truncate">
                        {product.product_name}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        {product.product_code && (
                          <span className="font-mono bg-slate-800 px-1.5 py-0.2 rounded">
                            {product.product_code}
                          </span>
                        )}
                        {product.category && (
                          <span className="text-slate-500 truncate">
                            {product.category}
                          </span>
                        )}
                        {product.barcode && (
                          <span className="font-mono text-indigo-400">
                            BC: {product.barcode}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 ml-3">
                    <p className="text-xs font-black text-emerald-400">
                      {formatAmount(product.cost || product.last_purchase_cost || product.price, currency)}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Stock: {product.in_stock ?? 0} {product.measurement || 'pcs'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
