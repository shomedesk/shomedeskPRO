import React from 'react';
import { PurchaseLog, Business, Branch, Supplier } from '@/src/types';
import { format } from 'date-fns';
import { X, ShoppingCart, CheckCircle2, Download } from 'lucide-react';
import { Barcode } from './Barcode';
import { formatAmount } from '@/src/lib/currencyUtils';
import { generateBillPdf } from '@/src/lib/pdfUtils';

interface BillReceiptModalProps {
  log: PurchaseLog | null;
  onClose: () => void;
  currency: string;
  business?: Business | null;
  branch?: Branch | null;
  supplier?: Supplier | null;
}

export function BillReceiptModal({
  log,
  onClose,
  currency,
  business,
  branch,
  supplier,
}: BillReceiptModalProps) {
  if (!log) return null;

  const handleDownloadPdf = () => {
    generateBillPdf({ log, business, branch, supplier, currency });
  };

  const invoiceDate = log.date ? format(new Date(log.date), 'dd MMM yyyy, hh:mm a') : 'N/A';
  const billAmount = Number(log.billAmount || (log as any).amount || 0);
  const paidAmount = Number(log.paidAmount || 0);
  const openingDue = Number(log.openingDue || 0);
  const netDue = Number(log.netDue ?? (openingDue + billAmount - paidAmount));
  const paymentModeLabel = log.paymentMode || log.paymentType || 'CASH';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl my-8 flex flex-col">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2 text-blue-400">
            <ShoppingCart size={20} />
            <h3 className="text-sm font-black uppercase tracking-wider">Purchase Bill Receipt</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
              title="Download vector PDF file"
            >
              <Download size={16} />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-all cursor-pointer ml-1"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Printable Bill Area */}
        <div id="printable-bill" className="p-8 bg-white text-slate-900 space-y-6">
          {/* Header */}
          <div className="border-b-2 border-slate-900 pb-5 flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-950">
                {business?.name || 'SHOMEDESK BUSINESS'}
              </h1>
              {branch && (
                <p className="text-xs font-semibold text-slate-600 mt-0.5">
                  Branch: {branch.name} ({branch.branchCode || 'BR'}) • {branch.location || ''}
                </p>
              )}
              {business?.mobileNumber && (
                <p className="text-xs text-slate-500">Phone: {business.mobileNumber}</p>
              )}
            </div>
            <div className="text-right">
              <span className="inline-block bg-slate-900 text-white text-[11px] font-black px-3 py-1 rounded uppercase tracking-wider mb-1">
                Purchase Bill
              </span>
              <p className="text-xs font-mono font-bold text-slate-700">INV: #{log.invoiceNumber}</p>
              <p className="text-[11px] text-slate-500">{invoiceDate}</p>
              {log.invoiceNumber && (
                <div className="mt-1 flex justify-end">
                  <Barcode value={log.invoiceNumber} height={24} width={1} fontSize={8} />
                </div>
              )}
            </div>
          </div>

          {/* Supplier Info */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Supplier Details</p>
              <p className="font-bold text-sm text-slate-900 mt-0.5">{log.supplierName}</p>
              {supplier?.phone && <p className="text-slate-600">Phone: {supplier.phone}</p>}
              {supplier?.address && <p className="text-slate-600">{supplier.address}</p>}
              {supplier?.category && <p className="text-slate-500 italic">Category: {supplier.category}</p>}
            </div>
            <div className="text-right flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Status</p>
                <div className="flex items-center justify-end gap-1.5 text-emerald-600 font-bold text-xs mt-1">
                  <CheckCircle2 size={14} />
                  <span>Verified & Received</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-600">
                Payment Mode: <span className="font-bold text-slate-900">{paymentModeLabel}</span>
                {log.bankName ? ` (${log.bankName})` : ''}
              </p>
            </div>
          </div>

          {/* Items breakdown */}
          {log.items && log.items.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-wider text-slate-700">Invoice Items</p>
              <div className="border border-slate-200 rounded-xl overflow-x-auto overflow-y-hidden scrollbar-thin">
                <table className="w-full min-w-[550px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider">
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3 text-center">Barcode</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Cost ({currency})</th>
                      <th className="py-2.5 px-3 text-right">Total ({currency})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                    {log.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-slate-400">{idx + 1}</td>
                        <td className="py-2 px-3 font-bold text-slate-900">
                          {item.name}
                          {item.category && (
                            <span className="block text-[10px] font-normal text-slate-500">
                              {item.category}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {item.barcode ? (
                            <Barcode value={item.barcode} height={26} width={1.1} fontSize={9} />
                          ) : (
                            <span className="text-slate-400 italic text-[10px]">-</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-bold font-mono">
                          {Number(item.quantity || 1).toFixed(3)} {item.unit || 'pcs'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{formatAmount(item.unitPrice, currency)}</td>
                        <td className="py-2 px-3 text-right font-black font-mono">
                          {formatAmount(item.totalPrice || item.quantity * item.unitPrice, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-center">
              <p className="text-xs text-slate-600 font-medium">Standard Purchase Bill Entry</p>
              <p className="text-xs text-slate-400 mt-0.5">Recorded directly with invoice total and payment amounts</p>
            </div>
          )}

          {/* Financial Calculation Box */}
          <div className="border-t-2 border-slate-900 pt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Previous Due Balance:</span>
                <span className="font-bold text-rose-700 font-mono">{currency} {formatAmount(openingDue, currency)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 text-sm">
                <span>Bill Amount:</span>
                <span className="font-black text-blue-700 font-mono">{currency} {formatAmount(billAmount, currency)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Paid Amount ({paymentModeLabel}):</span>
                <span className="font-bold text-emerald-700 font-mono">(-) {currency} {formatAmount(paidAmount, currency)}</span>
              </div>
              <div className="flex justify-between text-slate-950 font-black text-base border-t border-slate-900 pt-2">
                <span>Net Outstanding Due:</span>
                <span className={netDue > 0 ? "text-rose-700 font-mono" : "text-emerald-700 font-mono"}>
                  {currency} {formatAmount(netDue, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer & Signature lines */}
          <div className="pt-8 border-t border-slate-200 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
            <div className="border-t border-slate-300 pt-2 mt-8">
              <p className="font-bold text-slate-700">Received By (Store Manager)</p>
              <p className="text-[10px] text-slate-400">Signature & Date</p>
            </div>
            <div className="border-t border-slate-300 pt-2 mt-8">
              <p className="font-bold text-slate-700">Authorized Signatory</p>
              <p className="text-[10px] text-slate-400">ShomeDesk Business</p>
            </div>
          </div>
        </div>

        {/* Modal Bottom Action Bar */}
        <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-950/80">
          <p className="text-xs text-slate-400">
            Invoice: <span className="font-mono font-bold text-slate-200">#{log.invoiceNumber}</span>
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow transition-all cursor-pointer active:scale-95"
            >
              <Download size={15} />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold py-2 px-4 rounded-xl transition-all cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
