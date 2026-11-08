import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  Download, 
  FileSpreadsheet, 
  Calendar, 
  Search, 
  Filter, 
  Truck, 
  Building2, 
  MapPin, 
  Wallet, 
  CreditCard, 
  Landmark, 
  Eye, 
  ChevronDown, 
  ChevronUp, 
  Package, 
  Receipt, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw,
  Clock,
  Layers
} from 'lucide-react';
import { 
  Supplier, 
  PurchaseLog, 
  Branch, 
  Business, 
  PurchaseOrderItem 
} from '@/src/types';
import { 
  format, 
  parseISO, 
  isWithinInterval, 
  startOfDay, 
  endOfDay, 
  startOfMonth, 
  endOfMonth, 
  subMonths 
} from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { cn } from '@/src/lib/utils';
import { formatAmount, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import { BillReceiptModal } from './BillReceiptModal';
import { generateSupplierStatementPdf } from '@/src/lib/pdfUtils';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/src/lib/firebase';

interface SupplierStatementModalProps {
  supplier: Supplier;
  currency: string;
  logs: PurchaseLog[];
  branches: Branch[];
  businesses: Business[];
  selectedBusiness?: Business | null;
  onClose: () => void;
}

type PeriodFilter = 'all' | 'this_month' | 'last_month' | 'last_3_months' | 'custom';
type StatusFilter = 'all' | 'due' | 'paid';

export function SupplierStatementModal({
  supplier,
  currency,
  logs: propLogs,
  branches,
  businesses,
  selectedBusiness,
  onClose
}: SupplierStatementModalProps) {
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedMonth, setSelectedMonth] = useState<string>('all'); // e.g. "2026-11"
  const [searchTerm, setSearchTerm] = useState('');
  const [customStartDate, setCustomStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [expandedBillIds, setExpandedBillIds] = useState<Set<string>>(new Set());
  const [viewingReceiptLog, setViewingReceiptLog] = useState<PurchaseLog | null>(null);
  
  // Extra fetched logs state if local propLogs don't have all historic supplier bills
  const [allSupplierLogs, setAllSupplierLogs] = useState<PurchaseLog[]>([]);
  const [loadingHistoric, setLoadingHistoric] = useState(false);

  // Initialize with matching propLogs
  useEffect(() => {
    const matched = propLogs.filter(l => l.supplierId === supplier.id);
    setAllSupplierLogs(matched);

    // Also fetch all historical purchase logs for this supplier from Firestore to ensure complete lifetime statement
    if (supplier.id) {
      setLoadingHistoric(true);
      const q = query(
        collection(db, 'purchaseLogs'),
        where('supplierId', '==', supplier.id)
      );
      getDocs(q)
        .then(snap => {
          const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseLog));
          // Merge unique by id
          const map = new Map<string, PurchaseLog>();
          matched.forEach(l => { if (l.id) map.set(l.id, l); });
          fetched.forEach(l => { if (l.id) map.set(l.id, l); });
          const combined = Array.from(map.values()).sort(
            (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
          );
          setAllSupplierLogs(combined);
        })
        .catch(err => {
          console.warn('Notice loading full historical supplier logs:', err);
        })
        .finally(() => {
          setLoadingHistoric(false);
        });
    }
  }, [supplier.id, propLogs]);

  // Extract unique available months from the supplier's actual bills
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    allSupplierLogs.forEach(l => {
      if (l.date) {
        try {
          const mStr = format(parseISO(l.date), 'yyyy-MM');
          monthsSet.add(mStr);
        } catch {
          // ignore parsing error
        }
      }
    });
    return Array.from(monthsSet).sort().reverse();
  }, [allSupplierLogs]);

  // Handle quick period pills
  const handlePeriodChange = (newPeriod: PeriodFilter) => {
    setPeriod(newPeriod);
    setSelectedMonth('all');
    const now = new Date();
    if (newPeriod === 'this_month') {
      setCustomStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setCustomEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
    } else if (newPeriod === 'last_month') {
      const prev = subMonths(now, 1);
      setCustomStartDate(format(startOfMonth(prev), 'yyyy-MM-dd'));
      setCustomEndDate(format(endOfMonth(prev), 'yyyy-MM-dd'));
    } else if (newPeriod === 'last_3_months') {
      const threeMonthsAgo = subMonths(now, 3);
      setCustomStartDate(format(startOfMonth(threeMonthsAgo), 'yyyy-MM-dd'));
      setCustomEndDate(format(now, 'yyyy-MM-dd'));
    }
  };

  // Filtered bills based on all user inputs
  const filteredLogs = useMemo(() => {
    return allSupplierLogs.filter(log => {
      // 1. Date / Month Filter
      if (log.date) {
        try {
          const logDate = parseISO(log.date);

          // If a specific month dropdown is selected
          if (selectedMonth !== 'all') {
            const mStr = format(logDate, 'yyyy-MM');
            if (mStr !== selectedMonth) return false;
          } else if (period !== 'all') {
            const start = startOfDay(parseISO(customStartDate));
            const end = endOfDay(parseISO(customEndDate));
            if (!isWithinInterval(logDate, { start, end })) {
              return false;
            }
          }
        } catch {
          // keep if invalid date
        }
      }

      // 2. Status Filter
      const bill = Number(log.billAmount || (log as any).amount || 0);
      const paid = Number(log.paidAmount || 0);
      const due = Number(log.netDue ?? Math.max(0, bill - paid));

      if (statusFilter === 'due' && due <= 0.001) return false;
      if (statusFilter === 'paid' && due > 0.001) return false;

      // 3. Search Filter (Invoice #, Notes, or Item names)
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const invoiceMatches = (log.invoiceNumber || '').toLowerCase().includes(term);
        const notesMatches = (log.notes || '').toLowerCase().includes(term);
        const itemMatches = (log.items || []).some(item => 
          (item.name || '').toLowerCase().includes(term) ||
          (item.barcode || '').toLowerCase().includes(term) ||
          (item.productCode || '').toLowerCase().includes(term)
        );
        if (!invoiceMatches && !notesMatches && !itemMatches) {
          return false;
        }
      }

      return true;
    });
  }, [allSupplierLogs, selectedMonth, period, customStartDate, customEndDate, statusFilter, searchTerm]);

  // Overall Financial Totals for filtered logs
  const totals = useMemo(() => {
    let totalPurchased = 0;
    let totalPaid = 0;
    let totalDue = 0;
    let totalItemsCount = 0;

    filteredLogs.forEach(log => {
      const bill = Number(log.billAmount || (log as any).amount || 0);
      const paid = Number(log.paidAmount || 0);
      const due = Number(log.netDue ?? Math.max(0, bill - paid));

      totalPurchased += bill;
      totalPaid += paid;
      totalDue += due;

      const itemsQty = (log.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      totalItemsCount += itemsQty;
    });

    return {
      billCount: filteredLogs.length,
      totalPurchased: toStrictDecimal3(totalPurchased),
      totalPaid: toStrictDecimal3(totalPaid),
      totalDue: toStrictDecimal3(totalDue),
      totalItemsCount,
    };
  }, [filteredLogs]);

  // Group by Month ("kon mashe koto takar Mal niyechi")
  const monthlySummary = useMemo(() => {
    const map = new Map<string, {
      monthKey: string;
      monthLabel: string;
      billsCount: number;
      totalPurchased: number;
      totalPaid: number;
      totalDue: number;
      itemsCount: number;
    }>();

    allSupplierLogs.forEach(log => {
      if (!log.date) return;
      try {
        const d = parseISO(log.date);
        const mKey = format(d, 'yyyy-MM');
        const mLabel = format(d, 'MMMM yyyy');

        const bill = Number(log.billAmount || (log as any).amount || 0);
        const paid = Number(log.paidAmount || 0);
        const due = Number(log.netDue ?? Math.max(0, bill - paid));
        const itemsQty = (log.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

        if (!map.has(mKey)) {
          map.set(mKey, {
            monthKey: mKey,
            monthLabel: mLabel,
            billsCount: 0,
            totalPurchased: 0,
            totalPaid: 0,
            totalDue: 0,
            itemsCount: 0,
          });
        }

        const entry = map.get(mKey)!;
        entry.billsCount += 1;
        entry.totalPurchased = toStrictDecimal3(entry.totalPurchased + bill);
        entry.totalPaid = toStrictDecimal3(entry.totalPaid + paid);
        entry.totalDue = toStrictDecimal3(entry.totalDue + due);
        entry.itemsCount += itemsQty;
      } catch {
        // ignore
      }
    });

    return Array.from(map.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [allSupplierLogs]);

  const toggleExpand = (billId: string) => {
    setExpandedBillIds(prev => {
      const next = new Set(prev);
      if (next.has(billId)) {
        next.delete(billId);
      } else {
        next.add(billId);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allIds = new Set(filteredLogs.map(l => l.id || l.invoiceNumber).filter(Boolean) as string[]);
    setExpandedBillIds(allIds);
  };

  const collapseAll = () => {
    setExpandedBillIds(new Set());
  };

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    if (filteredLogs.length === 0) {
      toast.error('No purchase records to export');
      return;
    }

    try {
      const rows = filteredLogs.map((log, index) => {
        const branchObj = branches.find(b => b.id === log.branchId);
        const bill = Number(log.billAmount || (log as any).amount || 0);
        const paid = Number(log.paidAmount || 0);
        const due = Number(log.netDue ?? Math.max(0, bill - paid));
        const paymentMode = log.paymentMode || log.paymentType || 'CASH';

        // Item details text summary
        const itemsSummary = (log.items || [])
          .map(item => {
            const packTxt = item.orderMode === 'pack' && item.piecesPerPack ? ` (${item.piecesPerPack} pcs/pack)` : '';
            return `${item.name} x ${item.quantity}${packTxt} = ${formatAmount(item.totalPrice || 0, currency)}`;
          })
          .join('; ');

        return {
          'SL': index + 1,
          'Date': log.date ? format(new Date(log.date), 'dd/MM/yyyy') : 'N/A',
          'Month': log.date ? format(new Date(log.date), 'MMMM yyyy') : 'N/A',
          'Invoice / Bill #': log.invoiceNumber || 'N/A',
          'Supplier': supplier.name,
          'Branch': branchObj?.name || 'Main Branch',
          'Products / Mal Description': itemsSummary || 'General goods',
          'Total Mal Amount': bill,
          'Paid Amount': paid,
          'Due Balance': due,
          'Payment Mode': paymentMode,
          'Bank / Account': log.bankName || 'N/A',
          'Notes': log.notes || '',
        };
      });

      // Summary row
      rows.push({
        'SL': '' as any,
        'Date': 'TOTAL',
        'Month': '',
        'Invoice / Bill #': `${totals.billCount} Bills`,
        'Supplier': '',
        'Branch': '',
        'Products / Mal Description': `${totals.totalItemsCount} Total Units`,
        'Total Mal Amount': totals.totalPurchased,
        'Paid Amount': totals.totalPaid,
        'Due Balance': totals.totalDue,
        'Payment Mode': '',
        'Bank / Account': '',
        'Notes': '',
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Supplier Statement');

      // Auto width
      worksheet['!cols'] = [
        { wch: 6 },
        { wch: 12 },
        { wch: 15 },
        { wch: 20 },
        { wch: 22 },
        { wch: 16 },
        { wch: 45 },
        { wch: 16 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 18 },
        { wch: 25 },
      ];

      const cleanSupplierName = supplier.name.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `Supplier_Statement_${cleanSupplierName}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
      XLSX.writeFile(workbook, filename);
      toast.success('Supplier statement downloaded as Excel file!');
    } catch (err: any) {
      toast.error(`Excel export error: ${err?.message || 'Failed'}`);
    }
  };

  // Download Statement Vector PDF
  const handleDownloadPdf = () => {
    let periodLabel = 'All Time';
    if (selectedMonth !== 'all') {
      try {
        periodLabel = format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy');
      } catch {
        periodLabel = selectedMonth;
      }
    } else if (period === 'this_month') {
      periodLabel = 'This Month';
    } else if (period === 'last_month') {
      periodLabel = 'Last Month';
    } else if (period === 'last_3_months') {
      periodLabel = 'Last 3 Months';
    } else if (period === 'custom') {
      periodLabel = `${customStartDate} to ${customEndDate}`;
    }

    generateSupplierStatementPdf({
      supplier,
      logs: filteredLogs,
      currency,
      business: businessObj,
      branch: branchObj,
      totals,
      periodLabel,
    });
  };

  const branchObj = supplier.branchId ? branches.find(b => b.id === supplier.branchId) : null;
  const businessObj = selectedBusiness || businesses.find(b => b.id === supplier.businessId);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-6xl overflow-hidden shadow-2xl my-4 sm:my-8 flex flex-col max-h-[95vh] print:max-h-none print:bg-white print:border-none print:shadow-none print:text-black">
        
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6 border-b border-slate-800 bg-slate-950/70 print:border-b-2 print:border-black print:bg-white">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-600/10 border border-emerald-500/30 rounded-2xl text-emerald-400 print:text-black print:border-black">
              <Truck size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-100 uppercase tracking-wide print:text-black">
                  {supplier.name}
                </h2>
                {supplier.category && (
                  <span className="text-[10px] font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700 print:bg-slate-200 print:text-black">
                    {supplier.category}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-medium flex flex-wrap items-center gap-2 mt-0.5 print:text-slate-700">
                <span>Party Purchase & Payment Statement</span>
                {supplier.phone && (
                  <>
                    <span className="text-slate-600 print:text-black">•</span>
                    <span>Ph: {supplier.phone}</span>
                  </>
                )}
                {supplier.contactPerson && (
                  <>
                    <span className="text-slate-600 print:text-black">•</span>
                    <span>Contact: {supplier.contactPerson}</span>
                  </>
                )}
                {branchObj && (
                  <>
                    <span className="text-slate-600 print:text-black">•</span>
                    <span className="text-blue-400 print:text-black flex items-center gap-1">
                      <MapPin size={11} />
                      {branchObj.name}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-900/30 cursor-pointer active:scale-95"
              title="Download Statement in Excel (.xlsx)"
            >
              <FileSpreadsheet size={15} />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-900/30 cursor-pointer active:scale-95"
              title="Download vector PDF Statement file"
            >
              <Download size={15} />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              title="Close Statement"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 space-y-6 overflow-y-auto">
          
          {/* Key Metric Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 print:grid-cols-4">
            {/* Total Mal Purchased */}
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 print:border-black print:bg-white">
              <div className="flex items-center justify-between text-blue-400 print:text-black mb-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 print:text-slate-700">Total Mal Taken</p>
                <Package size={16} />
              </div>
              <p className="text-lg sm:text-xl font-black font-mono text-slate-100 print:text-black">
                {currency} {formatAmount(totals.totalPurchased, currency)}
              </p>
              <p className="text-[10px] font-bold text-slate-500 print:text-slate-600 mt-1">
                {totals.billCount} Bills • {totals.totalItemsCount} Total Units
              </p>
            </div>

            {/* Total Paid */}
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 print:border-black print:bg-white">
              <div className="flex items-center justify-between text-emerald-400 print:text-black mb-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 print:text-slate-700">Total Paid Amount</p>
                <Wallet size={16} />
              </div>
              <p className="text-lg sm:text-xl font-black font-mono text-emerald-400 print:text-black">
                {currency} {formatAmount(totals.totalPaid, currency)}
              </p>
              <p className="text-[10px] font-bold text-slate-500 print:text-slate-600 mt-1">
                Payments recorded across filtered bills
              </p>
            </div>

            {/* Current Total Due */}
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 print:border-black print:bg-white">
              <div className="flex items-center justify-between text-rose-400 print:text-black mb-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 print:text-slate-700">Filtered Due Balance</p>
                <AlertCircle size={16} />
              </div>
              <p className={cn(
                "text-lg sm:text-xl font-black font-mono print:text-black",
                totals.totalDue > 0 ? "text-rose-400" : "text-emerald-400"
              )}>
                {currency} {formatAmount(totals.totalDue, currency)}
              </p>
              <p className="text-[10px] font-bold text-slate-500 print:text-slate-600 mt-1">
                Outstanding for selected period
              </p>
            </div>

            {/* Lifetime Ledger Due in Supplier Profile */}
            <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800 print:border-black print:bg-white">
              <div className="flex items-center justify-between text-amber-400 print:text-black mb-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 print:text-slate-700">Master Total Due</p>
                <Building2 size={16} />
              </div>
              <p className={cn(
                "text-lg sm:text-xl font-black font-mono print:text-black",
                (supplier.totalDue || 0) > 0 ? "text-rose-400" : "text-emerald-400"
              )}>
                {currency} {formatAmount(supplier.totalDue || 0, currency)}
              </p>
              <p className="text-[10px] font-bold text-slate-500 print:text-slate-600 mt-1">
                Current total due in party account
              </p>
            </div>
          </div>

          {/* Month-wise Summary Cards Accordion ("Kon mashe koto takar Mal niyechi") */}
          <div className="bg-slate-950/50 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-3 print:border-black print:bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-300 print:text-black">
                <Calendar size={16} className="text-blue-400 print:text-black" />
                <h3 className="text-xs font-black uppercase tracking-wider">
                  Monthly Purchase Breakdown (কোন মাসে কত টাকার মাল নিয়েছি)
                </h3>
              </div>
              {selectedMonth !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth('all')}
                  className="text-[11px] font-bold text-blue-400 hover:text-blue-300 underline cursor-pointer print:hidden"
                >
                  Clear Month Filter (Show All)
                </button>
              )}
            </div>

            {monthlySummary.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2">No monthly purchase records found.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 print:grid-cols-3">
                {monthlySummary.map(m => {
                  const isSelected = selectedMonth === m.monthKey;
                  return (
                    <div
                      key={m.monthKey}
                      onClick={() => setSelectedMonth(isSelected ? 'all' : m.monthKey)}
                      className={cn(
                        "p-3 rounded-xl border transition-all cursor-pointer text-left print:cursor-default",
                        isSelected
                          ? "bg-blue-600/20 border-blue-500 shadow-md shadow-blue-900/20"
                          : "bg-slate-900/70 border-slate-800/80 hover:border-slate-700 print:bg-white print:border-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <p className={cn("text-xs font-black", isSelected ? "text-blue-300" : "text-slate-200 print:text-black")}>
                          {m.monthLabel}
                        </p>
                        <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono print:bg-slate-100 print:text-black">
                          {m.billsCount} bills
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-slate-400 print:text-slate-600">Mal Taken:</span>
                          <span className="font-bold font-mono text-slate-200 print:text-black">
                            {currency} {formatAmount(m.totalPurchased, currency)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 print:text-slate-600">Paid:</span>
                          <span className="font-bold font-mono text-emerald-400 print:text-black">
                            {currency} {formatAmount(m.totalPaid, currency)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 print:text-slate-600">Due:</span>
                          <span className={cn("font-bold font-mono print:text-black", m.totalDue > 0 ? "text-rose-400" : "text-slate-400")}>
                            {currency} {formatAmount(m.totalDue, currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Filter Bar */}
          <div className="bg-slate-950/70 p-4 rounded-2xl border border-slate-800 space-y-3 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Quick Period Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                  <Filter size={12} /> Period:
                </span>
                {(['all', 'this_month', 'last_month', 'last_3_months', 'custom'] as PeriodFilter[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePeriodChange(p)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                      period === p
                        ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    )}
                  >
                    {p.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">Status:</span>
                {(['all', 'due', 'paid'] as StatusFilter[]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                      statusFilter === s
                        ? s === 'due' ? "bg-rose-600 text-white" : s === 'paid' ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
                        : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Date Pickers & Search Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
              {/* Search Bar */}
              <div className="sm:col-span-5 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search invoice #, product name, barcode..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              {/* Month Selector Dropdown */}
              <div className="sm:col-span-3">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-blue-500 outline-none transition-all"
                >
                  <option value="all">All Months</option>
                  {availableMonths.map(mStr => {
                    const label = format(parseISO(`${mStr}-01`), 'MMMM yyyy');
                    return (
                      <option key={mStr} value={mStr}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Custom Date Range if Custom is Selected */}
              {period === 'custom' && (
                <>
                  <div className="sm:col-span-2">
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between text-xs text-slate-400 print:hidden">
            <p className="font-bold">
              Showing <span className="text-white font-mono">{filteredLogs.length}</span> bills / purchase entries
              {selectedMonth !== 'all' && (
                <span className="text-blue-400 font-semibold ml-1">
                  for {format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="text-xs text-slate-400 hover:text-white font-bold cursor-pointer transition-colors"
              >
                Expand All Items
              </button>
              <span className="text-slate-700">•</span>
              <button
                type="button"
                onClick={collapseAll}
                className="text-xs text-slate-400 hover:text-white font-bold cursor-pointer transition-colors"
              >
                Collapse All
              </button>
            </div>
          </div>

          {/* Detailed Bills Table */}
          <div className="bg-slate-950/60 rounded-2xl border border-slate-800 overflow-hidden print:border-black print:bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/80 border-b border-slate-800 text-[10px] uppercase font-black tracking-wider text-slate-400 print:bg-slate-100 print:text-black print:border-black">
                    <th className="py-3 px-3">SL</th>
                    <th className="py-3 px-3">Date & Time</th>
                    <th className="py-3 px-3">Bill / Invoice #</th>
                    <th className="py-3 px-3">Mal / Products Taken</th>
                    <th className="py-3 px-3">Payment</th>
                    <th className="py-3 px-3 text-right">Total Mal Cost</th>
                    <th className="py-3 px-3 text-right">Paid</th>
                    <th className="py-3 px-3 text-right">Due</th>
                    <th className="py-3 px-3 text-center print:hidden">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 print:divide-slate-300">
                  {filteredLogs.map((log, index) => {
                    const billId = log.id || log.invoiceNumber || `bill_${index}`;
                    const isExpanded = expandedBillIds.has(billId);
                    const bill = Number(log.billAmount || (log as any).amount || 0);
                    const paid = Number(log.paidAmount || 0);
                    const due = Number(log.netDue ?? Math.max(0, bill - paid));
                    const items = log.items || [];
                    const itemsCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
                    const paymentMode = log.paymentMode || log.paymentType || 'CASH';

                    return (
                      <React.Fragment key={billId}>
                        <tr className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-3 px-3 font-mono text-slate-500 text-[11px] print:text-black">
                            {index + 1}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <p className="font-bold text-slate-200 print:text-black">
                              {log.date ? format(new Date(log.date), 'dd MMM yyyy') : 'N/A'}
                            </p>
                            <p className="text-[10px] text-slate-500 print:text-slate-600 font-mono">
                              {log.date ? format(new Date(log.date), 'hh:mm a') : ''}
                            </p>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="font-mono font-bold text-blue-400 print:text-black">
                              {log.invoiceNumber}
                            </span>
                            {log.notes && (
                              <p className="text-[10px] text-slate-500 italic truncate max-w-[120px]">
                                {log.notes}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3 max-w-[240px]">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-200 print:text-black truncate">
                                {items.length > 0 
                                  ? `${items[0].name}${items.length > 1 ? ` +${items.length - 1} more` : ''}`
                                  : 'General Purchase'}
                              </span>
                              {items.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(billId)}
                                  className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer print:hidden"
                                  title="View itemized breakdown"
                                >
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-500 print:text-slate-600">
                              {items.length} items • {itemsCount} units
                            </p>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                              paymentMode.toLowerCase() === 'cash' ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                              paymentMode.toLowerCase() === 'bank' ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" :
                              paymentMode.toLowerCase() === 'card' ? "bg-purple-500/10 text-purple-400 border border-purple-500/20" :
                              paymentMode.toLowerCase() === 'due' ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" :
                              "bg-slate-800 text-slate-300"
                            )}>
                              {paymentMode}
                            </span>
                            {log.bankName && (
                              <p className="text-[9px] text-slate-500 truncate max-w-[90px]">{log.bankName}</p>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-100 print:text-black whitespace-nowrap">
                            {currency} {formatAmount(bill, currency)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400 print:text-black whitespace-nowrap">
                            {currency} {formatAmount(paid, currency)}
                          </td>
                          <td className={cn(
                            "py-3 px-3 text-right font-mono font-bold whitespace-nowrap print:text-black",
                            due > 0 ? "text-rose-400" : "text-slate-400"
                          )}>
                            {currency} {formatAmount(due, currency)}
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap print:hidden">
                            <button
                              type="button"
                              onClick={() => setViewingReceiptLog(log)}
                              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 rounded-lg text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1"
                              title="View printable Bill Receipt"
                            >
                              <Receipt size={12} />
                              <span>Receipt</span>
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Items Breakdown */}
                        {isExpanded && items.length > 0 && (
                          <tr className="bg-slate-900/70 border-b border-slate-800">
                            <td colSpan={9} className="py-3 px-4 sm:px-6">
                              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                  <Layers size={12} /> Itemized Products Breakdown for {log.invoiceNumber}
                                </p>
                                <div className="divide-y divide-slate-800/80">
                                  {items.map((item, iIdx) => {
                                    const itemTotal = Number(item.totalPrice) || 
                                      (item.orderMode === 'pack' && item.packPrice ? (Number(item.quantity) * Number(item.packPrice)) : (Number(item.quantity) * (Number(item.unitPrice) || 0)));
                                    return (
                                      <div key={iIdx} className="py-1.5 flex flex-wrap items-center justify-between text-xs gap-2">
                                        <div className="flex items-center gap-2">
                                          <span className="text-slate-500 font-mono text-[10px]">{iIdx + 1}.</span>
                                          <span className="font-bold text-slate-200">{item.name}</span>
                                          {item.barcode && (
                                            <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-1.5 rounded font-mono">
                                              {item.barcode}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-4 text-xs font-mono">
                                          <span className="text-slate-400">
                                            {item.quantity} {item.orderMode === 'pack' ? `packs (${item.piecesPerPack || 1} pcs/pk)` : 'units'}
                                          </span>
                                          <span className="text-slate-400">
                                            @ {currency} {formatAmount(item.orderMode === 'pack' ? (item.packPrice || 0) : (item.unitPrice || 0), currency)}
                                          </span>
                                          <span className="font-bold text-slate-100">
                                            = {currency} {formatAmount(itemTotal, currency)}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}

                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500 font-bold uppercase tracking-wider text-xs">
                        {searchTerm ? 'No bills match your search criteria' : 'No purchase bills logged for this supplier yet'}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900/90 font-mono text-xs border-t-2 border-slate-800 text-slate-200 print:bg-slate-100 print:text-black print:border-black">
                    <td colSpan={5} className="py-3 px-3 font-bold uppercase text-[11px] tracking-wider text-slate-400 print:text-black">
                      Total ({totals.billCount} Bills)
                    </td>
                    <td className="py-3 px-3 text-right font-black text-slate-100 print:text-black whitespace-nowrap">
                      {currency} {formatAmount(totals.totalPurchased, currency)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-emerald-400 print:text-black whitespace-nowrap">
                      {currency} {formatAmount(totals.totalPaid, currency)}
                    </td>
                    <td className={cn(
                      "py-3 px-3 text-right font-black whitespace-nowrap print:text-black",
                      totals.totalDue > 0 ? "text-rose-400" : "text-emerald-400"
                    )}>
                      {currency} {formatAmount(totals.totalDue, currency)}
                    </td>
                    <td className="print:hidden"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Printable Statement Footer (Visible on Print) */}
          <div className="hidden print:block pt-8 text-xs text-slate-800 space-y-4">
            <div className="flex justify-between items-center border-t border-black pt-4">
              <div>
                <p className="font-bold">Authorized Signature</p>
                <div className="w-48 h-12 border-b border-black mt-2"></div>
              </div>
              <div className="text-right">
                <p className="font-bold">Supplier Confirmation</p>
                <div className="w-48 h-12 border-b border-black mt-2"></div>
              </div>
            </div>
            <p className="text-center text-[10px] text-slate-500">
              Report generated on {format(new Date(), 'dd MMMM yyyy, hh:mm a')} • AI Studio Retail POS Management
            </p>
          </div>

        </div>

      </div>

      {/* Bill Receipt Modal (when clicking Receipt) */}
      {viewingReceiptLog && (
        <BillReceiptModal
          log={viewingReceiptLog}
          currency={currency}
          supplier={supplier}
          branch={branchObj}
          business={businessObj}
          onClose={() => setViewingReceiptLog(null)}
        />
      )}
    </div>
  );
}
