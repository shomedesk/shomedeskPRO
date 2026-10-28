import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeProps {
  value: string;
  width?: number;
  height?: number;
  displayValue?: boolean;
  fontSize?: number;
  className?: string;
}

export function Barcode({
  value,
  width = 1.3,
  height = 36,
  displayValue = true,
  fontSize = 11,
  className = '',
}: BarcodeProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (svgRef.current && value && typeof value === 'string' && value.trim()) {
      try {
        JsBarcode(svgRef.current, value.trim(), {
          format: 'CODE128',
          width,
          height,
          displayValue,
          fontSize,
          margin: 4,
          background: 'transparent',
          lineColor: '#0f172a', // slate-900 for high-contrast scan
        });
      } catch (err) {
        // If standard Code 128 fails (e.g. non-ascii), fallback gracefully
        console.warn('Barcode rendering fallback:', err);
      }
    }
  }, [value, width, height, displayValue, fontSize]);

  if (!value || !value.trim()) {
    return (
      <span className="text-[10px] text-slate-500 font-mono italic">
        No Barcode
      </span>
    );
  }

  return (
    <div className={`inline-block bg-white p-1 rounded border border-slate-300 shadow-xs ${className}`}>
      <svg ref={svgRef} className="block mx-auto max-w-full" />
    </div>
  );
}
