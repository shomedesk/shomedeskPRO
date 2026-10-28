import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Printer, 
  Download,
  FileSpreadsheet, 
  Calendar, 
  ArrowRightLeft, 
  Wallet, 
  Landmark, 
  TrendingUp, 
  TrendingDown,
  Building2,
  FileText,
  Filter,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DailyReport, Business, Branch, Service } from '../types';
import { format, parseISO, startOfMonth, endOfMonth, addMonths, isWithinInterval } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

interface MonthlyStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedBusiness: Business | null;
  branches: Branch[];
  services: Service[];
  initialBranchId?: string;
  initialServiceId?: string;
}

export const MonthlyStatementModal: React.FC<MonthlyStatementModalProps> = ({
  isOpen,
  onClose,
  selectedBusiness,
  branches,
  services,
  initialBranchId,
  initialServiceId,
}) => {
  // Date selection state
  const currentDate = new Date();
  const [filterMode, setFilterMode] = useState<'monthly' | 'custom_dates'>('monthly');
  const [customStartDate, setCustomStartDate] = useState(format(startOfMonth(currentDate), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(format(currentDate, 'yyyy-MM-dd'));
  const [startYear, setStartYear] = useState<number>(currentDate.getFullYear());
  const [startMonth, setStartMonth] = useState<number>(currentDate.getMonth()); // 0-11
  const [durationMonths, setDurationMonths] = useState<number>(1); // 1, 2, or 3 months (max 3 months as per requirement)

  // Scope filter: 'all' or specific branch or specific service
  const [targetScope, setTargetScope] = useState<string>(
    initialBranchId && initialBranchId !== 'global' 
      ? `branch:${initialBranchId}` 
      : initialServiceId && initialServiceId !== 'global'
      ? `service:${initialServiceId}`
      : 'all'
  );

  // Group by date or show individual records
  const [viewMode, setViewMode] = useState<'detailed' | 'daily_aggregate'>('detailed');

  const [loading, setLoading] = useState<boolean>(false);
  const [reports, setReports] = useState<DailyReport[]>([]);

  // Lock background body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isOpen]);

  // Sync default scope when opening
  useEffect(() => {
    if (isOpen) {
      if (initialBranchId && initialBranchId !== 'global') {
        setTargetScope(`branch:${initialBranchId}`);
      } else if (initialServiceId && initialServiceId !== 'global') {
        setTargetScope(`service:${initialServiceId}`);
      }
    }
  }, [isOpen, initialBranchId, initialServiceId]);

  // Calculate Start and End Date of the Statement period
  const dateRange = useMemo(() => {
    if (filterMode === 'custom_dates') {
      const startDate = parseISO(customStartDate);
      const endDate = parseISO(customEndDate);
      return { startDate, endDate };
    }
    const startDate = startOfMonth(new Date(startYear, startMonth, 1));
    // durationMonths: 1 => same month end; 2 => next month end; 3 => 2 months later end
    const endMonthDate = addMonths(startDate, Math.min(Math.max(durationMonths, 1), 3) - 1);
    const endDate = endOfMonth(endMonthDate);
    return { startDate, endDate };
  }, [filterMode, customStartDate, customEndDate, startYear, startMonth, durationMonths]);

  // Fetch reports within selected range
  const fetchStatementData = async () => {
    if (!selectedBusiness) return;
    setLoading(true);

    try {
      // Query all daily reports for this business to avoid complex composite index errors
      const q = query(
        collection(db, 'dailyReports'),
        where('businessId', '==', selectedBusiness.id)
      );

      const snapshot = await getDocs(q);
      const allReports = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as DailyReport));

      // Filter by date range (inclusive) and targetScope
      const filtered = allReports.filter(report => {
        try {
          const reportDate = new Date(report.date);
          const inDateRange = isWithinInterval(reportDate, {
            start: dateRange.startDate,
            end: dateRange.endDate
          });
          if (!inDateRange) return false;

          if (targetScope === 'all') return true;
          if (targetScope.startsWith('branch:')) {
            const bId = targetScope.replace('branch:', '');
            return report.branchId === bId;
          }
          if (targetScope.startsWith('service:')) {
            const sId = targetScope.replace('service:', '');
            return report.serviceId === sId;
          }
          return true;
        } catch {
          return false;
        }
      });

      // Sort chronologically (oldest to newest, like a bank statement)
      filtered.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setReports(filtered);
    } catch (err) {
      console.error('Failed to load statement reports:', err);
      toast.error('Failed to load statement reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && selectedBusiness) {
      fetchStatementData();
    }
  }, [isOpen, selectedBusiness, dateRange, targetScope]);

  // Formatted processed rows
  const displayRows = useMemo(() => {
    if (viewMode === 'detailed') {
      return reports;
    }

    // Daily aggregate: combine reports of the same date
    const map: { [dateStr: string]: DailyReport } = {};
    reports.forEach(r => {
      const dateKey = format(new Date(r.date), 'yyyy-MM-dd');
      if (!map[dateKey]) {
        map[dateKey] = {
          ...r,
          note: r.note ? `${r.note}` : ''
        };
      } else {
        map[dateKey].cashSale = (Number(map[dateKey].cashSale) || 0) + (Number(r.cashSale) || 0);
        map[dateKey].bankSale = (Number(map[dateKey].bankSale) || 0) + (Number(r.bankSale) || 0);
        map[dateKey].cashExpense = (Number(map[dateKey].cashExpense) || 0) + (Number(r.cashExpense) || 0);
        map[dateKey].bankExpense = (Number(map[dateKey].bankExpense) || 0) + (Number(r.bankExpense) || 0);
        map[dateKey].bankToCash = (Number(map[dateKey].bankToCash) || 0) + (Number(r.bankToCash) || 0);
        map[dateKey].cashToBank = (Number(map[dateKey].cashToBank) || 0) + (Number(r.cashToBank) || 0);
        // Closing cash & bank take the cumulative totals
        map[dateKey].closingCash = (Number(map[dateKey].closingCash) || 0) + (Number(r.closingCash) || 0);
        map[dateKey].closingBank = (Number(map[dateKey].closingBank) || 0) + (Number(r.closingBank) || 0);
        if (r.note) {
          map[dateKey].note = map[dateKey].note ? `${map[dateKey].note} | ${r.note}` : r.note;
        }
      }
    });

    return Object.values(map).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [reports, viewMode]);

  // Totals & KPI Metrics
  const totals = useMemo(() => {
    let totalCashSale = 0;
    let totalBankSale = 0;
    let totalCashExpense = 0;
    let totalBankExpense = 0;
    let totalBankToCash = 0;
    let totalCashToBank = 0;

    reports.forEach(r => {
      totalCashSale += Number(r.cashSale) || 0;
      totalBankSale += Number(r.bankSale) || 0;
      totalCashExpense += Number(r.cashExpense) || 0;
      totalBankExpense += Number(r.bankExpense) || 0;
      totalBankToCash += Number(r.bankToCash) || 0;
      totalCashToBank += Number(r.cashToBank) || 0;
    });

    const totalRevenue = totalCashSale + totalBankSale;
    const totalExpenses = totalCashExpense + totalBankExpense;
    const netProfit = totalRevenue - totalExpenses;

    const initialOpeningCash = reports.length > 0 ? Number(reports[0].openingCash) || 0 : 0;
    const initialOpeningBank = reports.length > 0 ? Number(reports[0].openingBank) || 0 : 0;
    const finalClosingCash = reports.length > 0 ? Number(reports[reports.length - 1].closingCash) || 0 : 0;
    const finalClosingBank = reports.length > 0 ? Number(reports[reports.length - 1].closingBank) || 0 : 0;

    return {
      totalCashSale,
      totalBankSale,
      totalRevenue,
      totalCashExpense,
      totalBankExpense,
      totalExpenses,
      totalBankToCash,
      totalCashToBank,
      netProfit,
      initialOpeningCash,
      initialOpeningBank,
      initialTotalLiquidity: initialOpeningCash + initialOpeningBank,
      finalClosingCash,
      finalClosingBank,
      finalTotalLiquidity: finalClosingCash + finalClosingBank,
      reportCount: reports.length
    };
  }, [reports]);

  const currency = selectedBusiness?.currency || '$';

  // Helper for scope label
  const getScopeLabel = () => {
    if (targetScope === 'all') return 'All Branches & Digital Services';
    if (targetScope.startsWith('branch:')) {
      const bId = targetScope.replace('branch:', '');
      return branches.find(b => b.id === bId)?.name || 'Branch';
    }
    if (targetScope.startsWith('service:')) {
      const sId = targetScope.replace('service:', '');
      return services.find(s => s.id === sId)?.name || 'Digital Service';
    }
    return 'All Branches';
  };

  const getEntityName = (r: DailyReport) => {
    if (r.branchId && r.branchId !== 'global') {
      return branches.find(b => b.id === r.branchId)?.name || 'Branch';
    }
    if (r.serviceId && r.serviceId !== 'global') {
      return services.find(s => s.id === r.serviceId)?.name || 'Digital Service';
    }
    return 'Headquarters';
  };

  // Export to Excel / Spreadsheet
  const handleExportExcel = () => {
    if (displayRows.length === 0) {
      toast.error('No statement data to export');
      return;
    }

    try {
      const exportData = displayRows.map((r, index) => {
        const netDayFlow = (Number(r.cashSale) || 0) + (Number(r.bankSale) || 0) - (Number(r.cashExpense) || 0) - (Number(r.bankExpense) || 0);
        return {
          'SL': index + 1,
          'Date': format(new Date(r.date), 'yyyy-MM-dd'),
          'Entity / Branch': getEntityName(r),
          'Opening Cash': Number(r.openingCash) || 0,
          'Opening Bank': Number(r.openingBank) || 0,
          'Cash Sale (+)': Number(r.cashSale) || 0,
          'Bank Sale (+)': Number(r.bankSale) || 0,
          'Cash Withdrawal (Bank→Cash) (+)': Number(r.bankToCash) || 0,
          'Bank Deposit (Cash→Bank) (+)': Number(r.cashToBank) || 0,
          'Cash Expense (-)': Number(r.cashExpense) || 0,
          'Bank Expense (-)': Number(r.bankExpense) || 0,
          'Net Day P&L': netDayFlow,
          'Closing Cash': Number(r.closingCash) || 0,
          'Closing Bank': Number(r.closingBank) || 0,
          'Total Liquidity': (Number(r.closingCash) || 0) + (Number(r.closingBank) || 0),
          'Remarks / Notes': r.note || ''
        };
      });

      // Add summary totals row
      exportData.push({
        'SL': '' as any,
        'Date': 'TOTALS',
        'Entity / Branch': `${displayRows.length} Days / Entries`,
        'Opening Cash': totals.initialOpeningCash,
        'Opening Bank': totals.initialOpeningBank,
        'Cash Sale (+)': totals.totalCashSale,
        'Bank Sale (+)': totals.totalBankSale,
        'Cash Withdrawal (Bank→Cash) (+)': totals.totalBankToCash,
        'Bank Deposit (Cash→Bank) (+)': totals.totalCashToBank,
        'Cash Expense (-)': totals.totalCashExpense,
        'Bank Expense (-)': totals.totalBankExpense,
        'Net Day P&L': totals.netProfit,
        'Closing Cash': totals.finalClosingCash,
        'Closing Bank': totals.finalClosingBank,
        'Total Liquidity': totals.finalTotalLiquidity,
        'Remarks / Notes': `Net Period Profit: ${totals.netProfit}`
      });

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Statement');

      const fileName = `${selectedBusiness?.name || 'Business'}_Statement_${format(dateRange.startDate, 'yyyy-MM-dd')}_to_${format(dateRange.endDate, 'yyyy-MM-dd')}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      toast.success('Statement exported to Excel successfully');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export statement');
    }
  };

  // PDF Statement Generation using native jsPDF + autoTable (No window.print or popup blockers)
  const handleDownloadPdf = () => {
    if (displayRows.length === 0) {
      toast.error('No statement data to export');
      return;
    }

    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const businessTitle = selectedBusiness?.name || 'SHOMEDESK BUSINESS';
      const scopeTitle = getScopeLabel();
      const periodStr = `${format(dateRange.startDate, 'dd MMM yyyy')} to ${format(dateRange.endDate, 'dd MMM yyyy')}`;

      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42);
      doc.text(businessTitle.toUpperCase(), 14, 14);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`FINANCIAL STATEMENT (BANK FORMAT) — Scope: ${scopeTitle} | Period: ${periodStr} | Currency: ${currency}`, 14, 20);

      const tableHeaders = [
        ['#', 'Date', 'Entity', 'Open Cash', 'Open Bank', 'Cash Sale', 'Bank Sale', 'B→C', 'C→B', 'Cash Exp', 'Bank Exp', 'Net P/L', 'Close Cash', 'Close Bank', 'Liquidity']
      ];

      const tableData = displayRows.map((r, i) => {
        const netDayFlow = (Number(r.cashSale) || 0) + (Number(r.bankSale) || 0) - (Number(r.cashExpense) || 0) - (Number(r.bankExpense) || 0);
        const totLiq = (Number(r.closingCash) || 0) + (Number(r.closingBank) || 0);
        return [
          String(i + 1),
          format(new Date(r.date), 'dd/MM/yyyy'),
          getEntityName(r),
          (Number(r.openingCash) || 0).toFixed(3),
          (Number(r.openingBank) || 0).toFixed(3),
          (Number(r.cashSale) || 0).toFixed(3),
          (Number(r.bankSale) || 0).toFixed(3),
          (Number(r.bankToCash) || 0) > 0 ? (Number(r.bankToCash) || 0).toFixed(3) : '-',
          (Number(r.cashToBank) || 0) > 0 ? (Number(r.cashToBank) || 0).toFixed(3) : '-',
          (Number(r.cashExpense) || 0).toFixed(3),
          (Number(r.bankExpense) || 0).toFixed(3),
          netDayFlow.toFixed(3),
          (Number(r.closingCash) || 0).toFixed(3),
          (Number(r.closingBank) || 0).toFixed(3),
          totLiq.toFixed(3),
        ];
      });

      // Totals row
      tableData.push([
        'TOTAL',
        '',
        '',
        totals.initialOpeningCash.toFixed(3),
        totals.initialOpeningBank.toFixed(3),
        totals.totalCashSale.toFixed(3),
        totals.totalBankSale.toFixed(3),
        totals.totalBankToCash.toFixed(3),
        totals.totalCashToBank.toFixed(3),
        totals.totalCashExpense.toFixed(3),
        totals.totalBankExpense.toFixed(3),
        totals.netProfit.toFixed(3),
        totals.finalClosingCash.toFixed(3),
        totals.finalClosingBank.toFixed(3),
        totals.finalTotalLiquidity.toFixed(3),
      ]);

      autoTable(doc, {
        head: tableHeaders,
        body: tableData,
        startY: 25,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.5, halign: 'right' },
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { halign: 'center', cellWidth: 7 },
          1: { halign: 'center', cellWidth: 18 },
          2: { halign: 'left', cellWidth: 26 },
        },
        didParseCell: (data) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [241, 245, 249];
          }
        }
      });

      const filename = `Financial_Statement_${format(dateRange.startDate, 'yyyyMMdd')}_${format(dateRange.endDate, 'yyyyMMdd')}.pdf`;
      doc.save(filename);
      toast.success(`Downloaded "${filename}" successfully!`);
    } catch (err) {
      console.error('PDF export error:', err);
      toast.error('Failed to generate PDF statement');
    }
  };

  if (!isOpen) return null;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const currentYearNum = new Date().getFullYear();
  const yearOptions = [currentYearNum - 2, currentYearNum - 1, currentYearNum, currentYearNum + 1];

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-slate-950/85 backdrop-blur-md p-2 sm:p-4 md:p-6 flex items-start sm:items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="relative w-full max-w-7xl bg-[#1E293B] border border-slate-700/80 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col my-auto max-h-[94vh] overflow-hidden animate-in fade-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Header (Fixed at top of modal) */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white uppercase tracking-wider">
                  Monthly Statement
                </h3>
                <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 whitespace-nowrap">
                  Bank Format
                </span>
              </div>
              <p className="text-xs font-bold text-slate-400 mt-0.5">
                {selectedBusiness?.name} • {getScopeLabel()} • Up to 3 Months Filter
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={handleExportExcel}
              disabled={displayRows.length === 0}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-xl text-xs font-black transition-all flex items-center gap-2 border border-slate-700 active:scale-95"
              title="Export to Excel"
            >
              <FileSpreadsheet size={15} className="text-emerald-400" />
              <span>Excel</span>
            </button>
            <button
              onClick={handleDownloadPdf}
              disabled={displayRows.length === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-blue-900/30 active:scale-95"
              title="Download Statement as PDF"
            >
              <Download size={15} />
              <span>Download PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors ml-1"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Scrollable Modal Content (Contains Filters, KPIs, Table, and Footer) */}
        <div className="flex-1 overflow-y-auto overscroll-contain flex flex-col divide-y divide-slate-800/80">
          
          {/* Filter Controls Bar */}
          <div className="p-4 sm:p-5 bg-slate-900/40 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end shrink-0">
            {/* Starting Month */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Calendar size={12} className="text-blue-400" /> Start Month
              </label>
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
              >
                {monthNames.map((m, idx) => (
                  <option key={m} value={idx}>{m}</option>
                ))}
              </select>
            </div>

            {/* Starting Year */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Year
              </label>
              <select
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
              >
                {yearOptions.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>

            {/* Duration Months (Max 3 Months) */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center justify-between">
                <span>Duration (Max 3 Mo.)</span>
                <span className="text-[9px] bg-blue-500/10 px-1.5 py-0.2 rounded text-blue-300">Capped</span>
              </label>
              <select
                value={durationMonths}
                onChange={(e) => setDurationMonths(Math.min(Number(e.target.value), 3))}
                className="w-full bg-slate-950 border border-blue-500/40 text-white rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
              >
                <option value={1}>1 Month ({monthNames[startMonth]})</option>
                <option value={2}>2 Months (Until {monthNames[(startMonth + 1) % 12]})</option>
                <option value={3}>3 Months (Max - Until {monthNames[(startMonth + 2) % 12]})</option>
              </select>
            </div>

            {/* Entity Scope Selector */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <Building2 size={12} className="text-amber-400" /> Branch / Service
              </label>
              <select
                value={targetScope}
                onChange={(e) => setTargetScope(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
              >
                <option value="all">All Branches & Services</option>
                {branches.map(b => (
                  <option key={b.id} value={`branch:${b.id}`}>Branch: {b.name}</option>
                ))}
                {services.map(s => (
                  <option key={s.id} value={`service:${s.id}`}>Service: {s.name}</option>
                ))}
              </select>
            </div>

            {/* View Mode */}
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Grouping</label>
              <select
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-500"
              >
                <option value="detailed">Detailed (Each Entry)</option>
                <option value="daily_aggregate">Group by Date</option>
              </select>
            </div>

            {/* Generate / Refresh Action Button */}
            <div>
              <button
                type="button"
                onClick={fetchStatementData}
                disabled={loading}
                className="w-full px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30 active:scale-95 h-[38px] disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                <span>{loading ? 'Loading...' : 'Generate'}</span>
              </button>
            </div>
          </div>

          {/* Financial KPI Summary Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4 sm:p-5 bg-slate-900/80 shrink-0">
            <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80">
              <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Starting Liquidity</span>
              <p className="text-sm font-black text-slate-200 mt-1">{currency}{totals.initialTotalLiquidity.toLocaleString()}</p>
              <span className="text-[9px] text-slate-500 block mt-0.5">Cash: {currency}{totals.initialOpeningCash.toLocaleString()}</span>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80">
              <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Total Sales (Inflow)</span>
              <p className="text-sm font-black text-emerald-400 mt-1">{currency}{totals.totalRevenue.toLocaleString()}</p>
              <span className="text-[9px] text-slate-500 block mt-0.5">Cash: {currency}{totals.totalCashSale.toLocaleString()} | Bank: {currency}{totals.totalBankSale.toLocaleString()}</span>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80">
              <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest">Total Expenses</span>
              <p className="text-sm font-black text-rose-400 mt-1">{currency}{totals.totalExpenses.toLocaleString()}</p>
              <span className="text-[9px] text-slate-500 block mt-0.5">Cash: {currency}{totals.totalCashExpense.toLocaleString()} | Bank: {currency}{totals.totalBankExpense.toLocaleString()}</span>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80">
              <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Internal Transfers</span>
              <p className="text-sm font-black text-blue-400 mt-1">
                Dep: {currency}{totals.totalCashToBank.toLocaleString()}
              </p>
              <span className="text-[9px] text-slate-500 block mt-0.5">W/D: {currency}{totals.totalBankToCash.toLocaleString()}</span>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80">
              <span className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Net Profit / Loss</span>
              <p className={`text-sm font-black mt-1 ${totals.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {currency}{totals.netProfit.toLocaleString()}
              </p>
              <span className="text-[9px] text-slate-500 block mt-0.5">{totals.reportCount} Days Recorded</span>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80">
              <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Closing Liquidity</span>
              <p className="text-sm font-black text-indigo-300 mt-1">{currency}{totals.finalTotalLiquidity.toLocaleString()}</p>
              <span className="text-[9px] text-slate-500 block mt-0.5">Cash: {currency}{totals.finalClosingCash.toLocaleString()} | Bank: {currency}{totals.finalClosingBank.toLocaleString()}</span>
            </div>
          </div>

          {/* Statement Table Content */}
          <div className="flex-1 overflow-x-auto p-4 sm:p-5 min-h-[300px]">
          {loading ? (
            <div className="py-24 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Generating statement...</p>
            </div>
          ) : displayRows.length === 0 ? (
            <div className="py-24 text-center space-y-3 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800">
              <FileText size={36} className="text-slate-600 mx-auto" />
              <p className="text-sm font-black text-slate-300 uppercase tracking-wider">No statement data found</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No daily reports were submitted for this entity between {format(dateRange.startDate, 'MMM dd, yyyy')} and {format(dateRange.endDate, 'MMM dd, yyyy')}.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="p-3 text-center w-12">#</th>
                  <th className="p-3 w-28">Date</th>
                  <th className="p-3 w-32">Branch/Entity</th>
                  <th className="p-3 text-right">Opening Cash</th>
                  <th className="p-3 text-right">Opening Bank</th>
                  <th className="p-3 text-right text-emerald-400">Cash Sale (+)</th>
                  <th className="p-3 text-right text-emerald-400">Bank Sale (+)</th>
                  <th className="p-3 text-right text-blue-400">Bank→Cash (W/D)</th>
                  <th className="p-3 text-right text-blue-400">Cash→Bank (Dep)</th>
                  <th className="p-3 text-right text-rose-400">Cash Exp (-)</th>
                  <th className="p-3 text-right text-rose-400">Bank Exp (-)</th>
                  <th className="p-3 text-right text-amber-400">Net Day P/L</th>
                  <th className="p-3 text-right text-emerald-400">Closing Cash</th>
                  <th className="p-3 text-right text-blue-400">Closing Bank</th>
                  <th className="p-3 text-right text-indigo-300">Total Liq</th>
                  <th className="p-3 min-w-[120px]">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {displayRows.map((r, idx) => {
                  const netDayFlow = (Number(r.cashSale) || 0) + (Number(r.bankSale) || 0) - (Number(r.cashExpense) || 0) - (Number(r.bankExpense) || 0);
                  const totLiq = (Number(r.closingCash) || 0) + (Number(r.closingBank) || 0);

                  return (
                    <tr key={r.id || idx} className="hover:bg-slate-800/40 transition-colors">
                      <td className="p-3 text-center text-slate-500 font-bold">{idx + 1}</td>
                      <td className="p-3 font-bold text-white whitespace-nowrap">
                        {format(new Date(r.date), 'MMM dd, yyyy')}
                      </td>
                      <td className="p-3 text-slate-300 font-medium whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md bg-slate-800/80 text-[10px] font-bold text-slate-300">
                          {getEntityName(r)}
                        </span>
                      </td>
                      <td className="p-3 text-right text-slate-400 font-mono">
                        {currency}{(Number(r.openingCash) || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-slate-400 font-mono">
                        {currency}{(Number(r.openingBank) || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-emerald-400 font-bold font-mono">
                        {currency}{(Number(r.cashSale) || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-emerald-400 font-bold font-mono">
                        {currency}{(Number(r.bankSale) || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-300">
                        {(Number(r.bankToCash) || 0) > 0 ? `${currency}${(Number(r.bankToCash) || 0).toLocaleString()}` : '-'}
                      </td>
                      <td className="p-3 text-right font-mono text-blue-300">
                        {(Number(r.cashToBank) || 0) > 0 ? `${currency}${(Number(r.cashToBank) || 0).toLocaleString()}` : '-'}
                      </td>
                      <td className="p-3 text-right text-rose-400 font-bold font-mono">
                        {currency}{(Number(r.cashExpense) || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-rose-400 font-bold font-mono">
                        {currency}{(Number(r.bankExpense) || 0).toLocaleString()}
                      </td>
                      <td className={`p-3 text-right font-black font-mono ${netDayFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {currency}{netDayFlow.toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-emerald-400 font-black font-mono">
                        {currency}{(Number(r.closingCash) || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-blue-400 font-black font-mono">
                        {currency}{(Number(r.closingBank) || 0).toLocaleString()}
                      </td>
                      <td className="p-3 text-right text-indigo-300 font-black font-mono">
                        {currency}{totLiq.toLocaleString()}
                      </td>
                      <td className="p-3 text-[11px] text-slate-400 italic max-w-xs truncate" title={r.note}>
                        {r.note || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-700 bg-slate-900 font-black text-xs">
                  <td colSpan={3} className="p-3 text-white uppercase tracking-wider">
                    STATEMENT TOTALS ({displayRows.length} ENTRIES)
                  </td>
                  <td className="p-3 text-right font-mono text-slate-300">
                    {currency}{totals.initialOpeningCash.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-slate-300">
                    {currency}{totals.initialOpeningBank.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-emerald-400">
                    {currency}{totals.totalCashSale.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-emerald-400">
                    {currency}{totals.totalBankSale.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-emerald-300">
                    {currency}{totals.totalBankToCash.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-blue-300">
                    {currency}{totals.totalCashToBank.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-rose-400">
                    {currency}{totals.totalCashExpense.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-rose-400">
                    {currency}{totals.totalBankExpense.toLocaleString()}
                  </td>
                  <td className={`p-3 text-right font-mono ${totals.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {currency}{totals.netProfit.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-emerald-400">
                    {currency}{totals.finalClosingCash.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-blue-400">
                    {currency}{totals.finalClosingBank.toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-indigo-300">
                    {currency}{totals.finalTotalLiquidity.toLocaleString()}
                  </td>
                  <td className="p-3 text-slate-500 font-normal text-[10px]">-</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-400" />
            <span>
              Statement range: <strong>{format(dateRange.startDate, 'MMM dd, yyyy')}</strong> to <strong>{format(dateRange.endDate, 'MMM dd, yyyy')}</strong> ({durationMonths} Month{durationMonths > 1 ? 's' : ''})
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            Note: Maximum 3 months can be generated at once for audit integrity.
          </div>
        </div>

        </div>{/* Closes flex-1 overflow-y-auto overscroll-contain */}

      </div>
    </div>
  );
};
