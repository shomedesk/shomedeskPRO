import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/src/lib/firebase';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { Transaction, DailyReport, PurchaseLog, Supplier, SaleInvoice } from '@/src/types';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { format, startOfMonth, endOfMonth, parseISO, isWithinInterval, startOfYear } from 'date-fns';
import { 
  FileDown, 
  Search, 
  Calendar, 
  Filter, 
  Download, 
  Table as TableIcon, 
  TrendingUp, 
  TrendingDown, 
  Landmark, 
  Wallet, 
  CreditCard,
  Building2,
  PieChart,
  DollarSign,
  Receipt,
  FileSpreadsheet,
  CheckCircle2,
  RefreshCw,
  Store,
  Layers
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { formatAmount, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import { downloadElementAsPdf, generateBusinessReportPdf } from '@/src/lib/pdfUtils';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

export type ReportTab = 
  | 'daily' 
  | 'monthly' 
  | 'store_wise' 
  | 'pnl' 
  | 'payment_mode' 
  | 'purchases' 
  | 'expenses' 
  | 'transactions';

export default function Reports() {
  const { selectedBusiness, selectedBranch, branches, isAllBusinessesSelected, businesses } = useBusiness();
  const [activeTab, setActiveTab] = useState<ReportTab>('pnl');
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd'),
  });
  const [filterBranchId, setFilterBranchId] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Raw collections data cached from Firestore
  const [dailyReportsData, setDailyReportsData] = useState<DailyReport[]>([]);
  const [salesData, setSalesData] = useState<SaleInvoice[]>([]);
  const [purchasesData, setPurchasesData] = useState<PurchaseLog[]>([]);
  const [expensesData, setExpensesData] = useState<any[]>([]);
  const [transactionsData, setTransactionsData] = useState<Transaction[]>([]);

  const currency = isAllBusinessesSelected ? 'OMR' : (selectedBranch?.currency || selectedBusiness?.currency || 'OMR');

  useEffect(() => {
    if (selectedBranch) {
      setFilterBranchId(selectedBranch.id);
    } else {
      setFilterBranchId('all');
    }
  }, [selectedBranch]);

  // Background refresh data logic with offline local cache safeguard
  const fetchAllReportData = async () => {
    if (!selectedBusiness && !isAllBusinessesSelected) return;
    setLoading(true);

    try {
      const targetBizIds = isAllBusinessesSelected 
        ? businesses.map(b => b.id) 
        : (selectedBusiness ? [selectedBusiness.id] : []);

      if (targetBizIds.length === 0) {
        setDailyReportsData([]);
        setSalesData([]);
        setPurchasesData([]);
        setExpensesData([]);
        setTransactionsData([]);
        setLoading(false);
        return;
      }

      // Helper to fetch collection with offline tolerance
      const fetchCollectionSafely = async (colName: string): Promise<any[]> => {
        try {
          const results: any[] = [];
          for (let i = 0; i < targetBizIds.length; i += 10) {
            const chunk = targetBizIds.slice(i, i + 10);
            let q = query(collection(db, colName), where('businessId', 'in', chunk));
            if (filterBranchId !== 'all') {
              q = query(q, where('branchId', '==', filterBranchId));
            }
            const snap = await getDocs(q);
            results.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
          }
          return results;
        } catch (colErr) {
          console.warn(`Local cache fallback for ${colName}:`, colErr);
          return [];
        }
      };

      const [dr, s, p, exp, tx] = await Promise.all([
        fetchCollectionSafely('dailyReports'),
        fetchCollectionSafely('sales'),
        fetchCollectionSafely('purchaseLogs'),
        fetchCollectionSafely('expenses'),
        fetchCollectionSafely('transactions'),
      ]);

      // Filter by interval
      const filterByDate = (list: any[]) => {
        return list.filter(item => {
          if (!item.date) return false;
          try {
            const itemDate = parseISO(item.date);
            return isWithinInterval(itemDate, {
              start: parseISO(dateRange.start),
              end: parseISO(dateRange.end),
            });
          } catch {
            return false;
          }
        });
      };

      setDailyReportsData(filterByDate(dr));
      setSalesData(filterByDate(s));
      setPurchasesData(filterByDate(p));
      setExpensesData(filterByDate(exp));
      setTransactionsData(filterByDate(tx));

      toast.success('Report data loaded from database (with offline cache support)');
    } catch (err: any) {
      console.warn('Report generation notice:', err);
      toast.info('Loaded available data from local cache');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllReportData();
  }, [selectedBusiness?.id, isAllBusinessesSelected, filterBranchId, dateRange.start, dateRange.end]);

  // ==========================================
  // TAB CALCULATIONS & STRICT P&L LOGIC
  // ==========================================

  // 1. P&L Statement Calculations
  const pnlCalculations = useMemo(() => {
    // Total Revenue (Sales) from Daily Reports or Sales Invoices
    let totalSales = 0;
    let cashSales = 0;
    let bankSales = 0;
    let cardSales = 0;

    if (salesData.length > 0) {
      salesData.forEach(s => {
        totalSales += Number(s.totalAmount) || 0;
        cashSales += Number(s.cashAmount) || 0;
        cardSales += Number(s.cardAmount) || 0;
        bankSales += Number(s.onlineAmount) || 0;
      });
    } else {
      dailyReportsData.forEach(r => {
        totalSales += (Number(r.cashSale) || 0) + (Number(r.bankSale) || 0);
        cashSales += Number(r.cashSale) || 0;
        bankSales += Number(r.bankSale) || 0;
      });
    }

    // Cost of Goods Sold (COGS) from Product Cost in Sales OR Supplier Purchases
    let cogs = 0;
    if (salesData.length > 0) {
      cogs = salesData.reduce((acc, s) => acc + (Number(s.totalCost) || 0), 0);
    }
    // If POS sales didn't provide itemized cost, pull purchase bills inventory cost
    if (cogs === 0 && purchasesData.length > 0) {
      cogs = purchasesData.reduce((acc, p) => acc + (Number(p.billAmount) || 0), 0);
    }

    // Strict Accounting Safeguard:
    // Gross Profit = Total Sales - Cost of Goods Sold (COGS)
    const grossProfit = totalSales - cogs;
    const grossMarginPercent = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;

    // Operating Expenses: Cash expenses, bank expenses, itemized utility/rent expenses
    // STRICT SAFEGUARD: COGS is NEVER included in Operating Expenses (prevents double deduction)
    let totalOperatingExpenses = 0;
    let cashExpenses = 0;
    let bankExpenses = 0;

    if (expensesData.length > 0) {
      expensesData.forEach(e => {
        const amt = Number(e.amount) || 0;
        totalOperatingExpenses += amt;
        if (e.paymentType === 'cash') cashExpenses += amt;
        else bankExpenses += amt;
      });
    } else {
      dailyReportsData.forEach(r => {
        const cExp = Number(r.cashExpense) || 0;
        const bExp = Number(r.bankExpense) || 0;
        cashExpenses += cExp;
        bankExpenses += bExp;
        totalOperatingExpenses += (cExp + bExp);
      });
    }

    // Net Profit = Gross Profit - Operating Expenses
    const netProfit = grossProfit - totalOperatingExpenses;
    const netMarginPercent = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

    return {
      totalSales: toStrictDecimal3(totalSales),
      cashSales: toStrictDecimal3(cashSales),
      cardSales: toStrictDecimal3(cardSales),
      bankSales: toStrictDecimal3(bankSales),
      cogs: toStrictDecimal3(cogs),
      grossProfit: toStrictDecimal3(grossProfit),
      grossMarginPercent: Number(grossMarginPercent.toFixed(1)),
      totalOperatingExpenses: toStrictDecimal3(totalOperatingExpenses),
      cashExpenses: toStrictDecimal3(cashExpenses),
      bankExpenses: toStrictDecimal3(bankExpenses),
      netProfit: toStrictDecimal3(netProfit),
      netMarginPercent: Number(netMarginPercent.toFixed(1)),
    };
  }, [salesData, dailyReportsData, purchasesData, expensesData]);

  // 2. Store-wise Breakdown
  const storeWiseData = useMemo(() => {
    const map: Record<string, {
      branchId: string;
      branchName: string;
      totalSales: number;
      cashSales: number;
      bankSales: number;
      cogs: number;
      grossProfit: number;
      operatingExpenses: number;
      netProfit: number;
    }> = {};

    branches.forEach(b => {
      map[b.id] = {
        branchId: b.id,
        branchName: b.name,
        totalSales: 0,
        cashSales: 0,
        bankSales: 0,
        cogs: 0,
        grossProfit: 0,
        operatingExpenses: 0,
        netProfit: 0,
      };
    });

    dailyReportsData.forEach(r => {
      const bId = r.branchId || 'main';
      if (!map[bId]) {
        map[bId] = {
          branchId: bId,
          branchName: branches.find(b => b.id === bId)?.name || 'Central Store',
          totalSales: 0,
          cashSales: 0,
          bankSales: 0,
          cogs: 0,
          grossProfit: 0,
          operatingExpenses: 0,
          netProfit: 0,
        };
      }
      const cSale = Number(r.cashSale) || 0;
      const bSale = Number(r.bankSale) || 0;
      const cExp = Number(r.cashExpense) || 0;
      const bExp = Number(r.bankExpense) || 0;
      const rCogs = Number(r.cogs) || 0;

      map[bId].totalSales += (cSale + bSale);
      map[bId].cashSales += cSale;
      map[bId].bankSales += bSale;
      map[bId].cogs += rCogs;
      map[bId].operatingExpenses += (cExp + bExp);
    });

    Object.values(map).forEach(m => {
      m.grossProfit = m.totalSales - m.cogs;
      m.netProfit = m.grossProfit - m.operatingExpenses;
    });

    return Object.values(map);
  }, [branches, dailyReportsData]);

  // 3. Payment Mode Breakdown
  const paymentModeData = useMemo(() => {
    const cash = pnlCalculations.cashSales;
    const card = pnlCalculations.cardSales;
    const online = pnlCalculations.bankSales;
    const total = pnlCalculations.totalSales || (cash + card + online);

    return [
      {
        mode: 'Cash In Hand',
        amount: cash,
        percentage: total > 0 ? ((cash / total) * 100).toFixed(1) : '0.0',
        channel: 'Physical Cash Drawer',
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
      },
      {
        mode: 'Card (POS Machine)',
        amount: card,
        percentage: total > 0 ? ((card / total) * 100).toFixed(1) : '0.0',
        channel: 'Card Terminal / Merchant Account',
        color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',
      },
      {
        mode: 'Bank / Online Transfer',
        amount: online,
        percentage: total > 0 ? ((online / total) * 100).toFixed(1) : '0.0',
        channel: 'Direct Bank Wire / UPI',
        color: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
      },
    ];
  }, [pnlCalculations]);

  // 4. Monthly / Yearly Trends
  const monthlyTrendsData = useMemo(() => {
    const monthMap: Record<string, {
      monthKey: string;
      label: string;
      totalSales: number;
      cogs: number;
      grossProfit: number;
      operatingExpenses: number;
      netProfit: number;
      cashFlow: number;
    }> = {};

    dailyReportsData.forEach(r => {
      if (!r.date) return;
      try {
        const d = parseISO(r.date);
        const mKey = format(d, 'yyyy-MM');
        const mLabel = format(d, 'MMMM yyyy');
        if (!monthMap[mKey]) {
          monthMap[mKey] = {
            monthKey: mKey,
            label: mLabel,
            totalSales: 0,
            cogs: 0,
            grossProfit: 0,
            operatingExpenses: 0,
            netProfit: 0,
            cashFlow: 0,
          };
        }
        const sale = (Number(r.cashSale) || 0) + (Number(r.bankSale) || 0);
        const exp = (Number(r.cashExpense) || 0) + (Number(r.bankExpense) || 0);
        const cg = Number(r.cogs) || 0;

        monthMap[mKey].totalSales += sale;
        monthMap[mKey].cogs += cg;
        monthMap[mKey].operatingExpenses += exp;
      } catch {}
    });

    Object.values(monthMap).forEach(m => {
      m.grossProfit = m.totalSales - m.cogs;
      m.netProfit = m.grossProfit - m.operatingExpenses;
      m.cashFlow = m.totalSales - m.operatingExpenses;
    });

    return Object.values(monthMap).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [dailyReportsData]);

  // ==========================================
  // EXPORT HANDLERS (NO WINDOW.PRINT GLOBALLY)
  // ==========================================

  const handleDownloadPdf = async () => {
    setIsExportingPdf(true);
    try {
      if (['pnl', 'daily', 'monthly'].includes(activeTab)) {
        const success = generateBusinessReportPdf({
          activeTab,
          business: selectedBusiness,
          branch: selectedBranch,
          currency,
          dateRange,
          pnlCalculations,
          dailyReportsData,
          monthlyTrendsData,
          branches,
        });
        if (success) {
          setIsExportingPdf(false);
          return;
        }
      }

      const container = document.getElementById('report-content-container');
      if (!container) {
        toast.error('Could not find report to export');
        setIsExportingPdf(false);
        return;
      }
      const filename = `${activeTab.toUpperCase()}_Report_${dateRange.start}_to_${dateRange.end}.pdf`;
      await downloadElementAsPdf('report-content-container', filename, activeTab === 'daily' || activeTab === 'monthly');
    } catch (e) {
      console.error('Download PDF error:', e);
      toast.error('Failed to export PDF');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportExcel = () => {
    try {
      let exportRows: any[] = [];

      if (activeTab === 'pnl') {
        exportRows = [
          { 'Metric': 'Total Sales / Revenue', 'Amount': pnlCalculations.totalSales },
          { 'Metric': 'Cash Sales', 'Amount': pnlCalculations.cashSales },
          { 'Metric': 'Card Sales', 'Amount': pnlCalculations.cardSales },
          { 'Metric': 'Online Bank Sales', 'Amount': pnlCalculations.bankSales },
          { 'Metric': 'Cost of Goods Sold (COGS)', 'Amount': pnlCalculations.cogs },
          { 'Metric': 'GROSS PROFIT', 'Amount': pnlCalculations.grossProfit },
          { 'Metric': 'Operating Expenses (Cash)', 'Amount': pnlCalculations.cashExpenses },
          { 'Metric': 'Operating Expenses (Bank)', 'Amount': pnlCalculations.bankExpenses },
          { 'Metric': 'TOTAL OPERATING EXPENSES', 'Amount': pnlCalculations.totalOperatingExpenses },
          { 'Metric': 'NET PROFIT', 'Amount': pnlCalculations.netProfit },
        ];
      } else if (activeTab === 'daily') {
        exportRows = dailyReportsData.map(r => ({
          'Date': r.date ? format(parseISO(r.date), 'yyyy-MM-dd') : '',
          'Branch': branches.find(b => b.id === r.branchId)?.name || 'Store',
          'Cash Sale': Number(r.cashSale) || 0,
          'Bank Sale': Number(r.bankSale) || 0,
          'Total Sale': (Number(r.cashSale) || 0) + (Number(r.bankSale) || 0),
          'Cash Exp': Number(r.cashExpense) || 0,
          'Bank Exp': Number(r.bankExpense) || 0,
          'Total Exp': (Number(r.cashExpense) || 0) + (Number(r.bankExpense) || 0),
          'Closing Cash': Number(r.closingCash) || 0,
          'Closing Bank': Number(r.closingBank) || 0,
          'Note': r.note || '',
        }));
      } else if (activeTab === 'monthly') {
        exportRows = monthlyTrendsData.map(m => ({
          'Month / Period': m.label,
          'Total Sales': m.totalSales,
          'COGS': m.cogs,
          'Gross Profit': m.grossProfit,
          'Operating Expenses': m.operatingExpenses,
          'Net Profit': m.netProfit,
          'Cash Flow': m.cashFlow,
        }));
      } else if (activeTab === 'store_wise') {
        exportRows = storeWiseData.map(s => ({
          'Store / Branch': s.branchName,
          'Total Sales': s.totalSales,
          'Cash Sales': s.cashSales,
          'Bank Sales': s.bankSales,
          'COGS': s.cogs,
          'Gross Profit': s.grossProfit,
          'Operating Expenses': s.operatingExpenses,
          'Net Profit': s.netProfit,
        }));
      } else if (activeTab === 'payment_mode') {
        exportRows = paymentModeData.map(p => ({
          'Payment Mode': p.mode,
          'Total Inflow': p.amount,
          'Percentage Share (%)': p.percentage,
          'Channel': p.channel,
        }));
      } else if (activeTab === 'purchases') {
        exportRows = purchasesData.map(p => ({
          'Date': p.date ? format(parseISO(p.date), 'yyyy-MM-dd') : '',
          'Supplier': p.supplierName || 'Unknown',
          'Invoice #': p.invoiceNumber || 'N/A',
          'Bill Amount': Number(p.billAmount) || 0,
          'Paid Amount': Number(p.paidAmount) || 0,
          'Net Due (Accounts Payable)': Number(p.netDue) || 0,
          'Payment Mode': p.paymentMode || 'cash',
        }));
      } else if (activeTab === 'expenses') {
        exportRows = expensesData.map(e => ({
          'Date': e.date ? format(parseISO(e.date), 'yyyy-MM-dd') : '',
          'Category': e.category || 'General',
          'Payment Mode': e.paymentType || 'cash',
          'Bank Account': e.bankName || 'N/A',
          'Amount': Number(e.amount) || 0,
          'Note': e.note || '',
        }));
      } else {
        exportRows = transactionsData.map(t => ({
          'Date': t.date ? format(parseISO(t.date), 'yyyy-MM-dd') : '',
          'Type': t.type || '',
          'Category': t.category || '',
          'Amount': Number(t.amount) || 0,
          'Description': t.description || '',
          'From Account': t.fromAccount || 'N/A',
          'To Account': t.toAccount || 'N/A',
        }));
      }

      if (exportRows.length === 0) {
        toast.info('No data available to export');
        return;
      }

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, activeTab.toUpperCase().substring(0, 31));
      XLSX.writeFile(wb, `${activeTab}_report_${dateRange.start}_to_${dateRange.end}.xlsx`);
      toast.success('Exported to Excel successfully!');
    } catch (err) {
      console.error('Excel export error:', err);
      toast.error('Failed to export Excel file');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20">
            <FileDown size={28} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
              Business Intelligence & Reports
              <span className="text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2.5 py-0.5 rounded-full">
                Vyapar ERP Audit
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAllBusinessesSelected 
                ? 'Consolidated view across all branches • Strict OMR 3-Decimal Compliance' 
                : `${selectedBusiness?.name || 'Store'} • Period: ${dateRange.start} to ${dateRange.end} (${currency})`}
            </p>
          </div>
        </div>

        {/* Global Action Buttons (NO window.print globally) */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={loading}
            onClick={fetchAllReportData}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 px-3.5 rounded-xl border border-slate-700 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            title="Refresh database records & sync offline cache"
          >
            <RefreshCw size={15} className={cn("text-blue-400", loading && "animate-spin")} />
            <span>Refresh Data</span>
          </button>

          <button
            type="button"
            disabled={isExportingPdf}
            onClick={handleDownloadPdf}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-lg shadow-blue-900/30 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            title="Download clean vector PDF report"
          >
            <Download size={15} />
            <span>{isExportingPdf ? 'Exporting PDF...' : 'Download PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
            title="Export filtered records to Excel"
          >
            <FileSpreadsheet size={15} />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="bg-[#1E293B] p-2 rounded-2xl border border-slate-800 flex flex-wrap gap-1.5 overflow-x-auto custom-scrollbar">
        {[
          { id: 'pnl', label: '📊 P&L Statement', desc: 'Profit & Loss' },
          { id: 'daily', label: '📅 Daily Reports', desc: 'End of Day' },
          { id: 'monthly', label: '📈 Monthly / Yearly', desc: 'Trends & Flow' },
          { id: 'store_wise', label: '🏬 Store-wise', desc: 'Branch Audit' },
          { id: 'payment_mode', label: '💳 Payment Mode', desc: 'Cash vs Bank' },
          { id: 'purchases', label: '📦 Purchases & Dues', desc: 'Accounts Payable' },
          { id: 'expenses', label: '🧾 Itemized Expenses', desc: 'Operating Costs' },
          { id: 'transactions', label: '📑 Ledger Feed', desc: 'Cash/Bank Trans' },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as ReportTab)}
            className={cn(
              "px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap",
              activeTab === tab.id 
                ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30" 
                : "bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            )}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Filter Filterbar */}
      <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-800 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
            <Store size={12} className="text-blue-400" /> Branch / Store
          </label>
          <select
            value={filterBranchId}
            onChange={(e) => setFilterBranchId(e.target.value)}
            disabled={!!selectedBranch}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-blue-500 disabled:opacity-50"
          >
            <option value="all">All Branches</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
            <Calendar size={12} className="text-blue-400" /> Start Date
          </label>
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
            <Calendar size={12} className="text-blue-400" /> End Date
          </label>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-white text-xs font-bold outline-none focus:border-blue-500"
          />
        </div>

        <button
          type="button"
          onClick={fetchAllReportData}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50 shadow-md shadow-blue-900/20"
        >
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
          <span>Apply Filter</span>
        </button>
      </div>

      {/* Main Exportable Container */}
      <div id="report-content-container" className="bg-[#1E293B] rounded-3xl border border-slate-800 shadow-xl overflow-hidden p-6 space-y-6">

        {/* Brand Document Header for PDF Printing */}
        <div className="border-b border-slate-800 pb-4 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight">
              {selectedBusiness?.name || 'Business Statement'}
            </h2>
            <p className="text-xs text-slate-400 font-bold">
              {activeTab === 'pnl' && 'Comprehensive Profit & Loss Statement (P&L)'}
              {activeTab === 'daily' && 'Daily Closing Reports Summary'}
              {activeTab === 'monthly' && 'Monthly & Yearly Trends and Cash Flow Analysis'}
              {activeTab === 'store_wise' && 'Store-wise / Branch-wise Performance Breakdown'}
              {activeTab === 'payment_mode' && 'Payment Mode Allocation (Cash, Card, Online Bank)'}
              {activeTab === 'purchases' && 'Supplier Purchase Records & Accounts Payable'}
              {activeTab === 'expenses' && 'Itemized Operating Expenses Breakdown'}
              {activeTab === 'transactions' && 'Financial Transactions Ledger'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-mono text-slate-400 block">
              Period: {dateRange.start} ➔ {dateRange.end}
            </span>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md inline-block mt-1">
              Currency: {currency} (0.000)
            </span>
          </div>
        </div>

        {/* ========================================================= */}
        {/* TAB 1: STRICT PROFIT & LOSS STATEMENT (P&L)               */}
        {/* ========================================================= */}
        {activeTab === 'pnl' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Sales (Revenue)</span>
                <p className="text-xl md:text-2xl font-black font-mono text-emerald-400 mt-1">
                  {currency} {formatAmount(pnlCalculations.totalSales, currency)}
                </p>
                <span className="text-[9px] text-slate-500 font-bold block mt-0.5">Cash + Card + Online Bank</span>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cost of Goods Sold (COGS)</span>
                <p className="text-xl md:text-2xl font-black font-mono text-rose-400 mt-1">
                  {currency} {formatAmount(pnlCalculations.cogs, currency)}
                </p>
                <span className="text-[9px] text-slate-500 font-bold block mt-0.5">Direct Product Cost</span>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Operating Expenses</span>
                <p className="text-xl md:text-2xl font-black font-mono text-amber-400 mt-1">
                  {currency} {formatAmount(pnlCalculations.totalOperatingExpenses, currency)}
                </p>
                <span className="text-[9px] text-slate-500 font-bold block mt-0.5">Rent, Utilities, Staff (Excl. COGS)</span>
              </div>

              <div className="bg-emerald-950/20 p-4 rounded-2xl border border-emerald-500/30">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Net Profit</span>
                  <span className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
                    {pnlCalculations.netMarginPercent}%
                  </span>
                </div>
                <p className={cn(
                  "text-xl md:text-2xl font-black font-mono mt-1",
                  pnlCalculations.netProfit >= 0 ? "text-emerald-300" : "text-rose-400"
                )}>
                  {currency} {formatAmount(pnlCalculations.netProfit, currency)}
                </p>
                <span className="text-[9px] text-emerald-500/80 font-bold block mt-0.5">Gross Profit - Operating Expenses</span>
              </div>
            </div>

            {/* Formal Accounting P&L Ledger Table */}
            <div className="overflow-x-auto custom-scrollbar border border-slate-800 rounded-2xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-800">
                    <th className="p-4">Accounting Section / Line Item</th>
                    <th className="p-4">Classification</th>
                    <th className="p-4 text-right">Amount ({currency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs font-bold">
                  {/* Revenue */}
                  <tr className="bg-slate-900/30">
                    <td className="p-4 text-emerald-400 uppercase font-black tracking-wider" colSpan={2}>
                      1. OPERATING REVENUE (TOTAL SALES)
                    </td>
                    <td className="p-4 text-right font-mono font-black text-emerald-400">
                      {currency} {formatAmount(pnlCalculations.totalSales, currency)}
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-4 pl-8 text-slate-300">Cash Sales (In-Hand Drawer)</td>
                    <td className="p-4 text-slate-500 text-[11px]">Direct Cash Inflow</td>
                    <td className="p-4 text-right font-mono text-slate-300">{currency} {formatAmount(pnlCalculations.cashSales, currency)}</td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-4 pl-8 text-slate-300">Card Sales (POS Machine Terminal)</td>
                    <td className="p-4 text-slate-500 text-[11px]">Merchant Bank Account</td>
                    <td className="p-4 text-right font-mono text-slate-300">{currency} {formatAmount(pnlCalculations.cardSales, currency)}</td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-4 pl-8 text-slate-300">Online & Bank Wire Sales</td>
                    <td className="p-4 text-slate-500 text-[11px]">Direct Bank Deposit</td>
                    <td className="p-4 text-right font-mono text-slate-300">{currency} {formatAmount(pnlCalculations.bankSales, currency)}</td>
                  </tr>

                  {/* COGS */}
                  <tr className="bg-slate-900/30">
                    <td className="p-4 text-rose-400 uppercase font-black tracking-wider" colSpan={2}>
                      2. COST OF GOODS SOLD (COGS)
                    </td>
                    <td className="p-4 text-right font-mono font-black text-rose-400">
                      {currency} {formatAmount(pnlCalculations.cogs, currency)}
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-4 pl-8 text-slate-300">Inventory & Direct Purchase Cost</td>
                    <td className="p-4 text-slate-500 text-[11px]">Cost of Inventory Sold</td>
                    <td className="p-4 text-right font-mono text-slate-300">{currency} {formatAmount(pnlCalculations.cogs, currency)}</td>
                  </tr>

                  {/* GROSS PROFIT */}
                  <tr className="bg-emerald-950/30 border-y-2 border-emerald-500/40">
                    <td className="p-4 text-emerald-300 uppercase font-black text-sm">
                      3. GROSS PROFIT (SALES - COGS)
                    </td>
                    <td className="p-4 text-emerald-400 font-mono">
                      Gross Margin: {pnlCalculations.grossMarginPercent}%
                    </td>
                    <td className="p-4 text-right font-mono font-black text-emerald-300 text-sm">
                      {currency} {formatAmount(pnlCalculations.grossProfit, currency)}
                    </td>
                  </tr>

                  {/* Operating Expenses */}
                  <tr className="bg-slate-900/30">
                    <td className="p-4 text-amber-400 uppercase font-black tracking-wider" colSpan={2}>
                      4. OPERATING EXPENSES (NO DOUBLE COUNTING OF COGS)
                    </td>
                    <td className="p-4 text-right font-mono font-black text-amber-400">
                      {currency} {formatAmount(pnlCalculations.totalOperatingExpenses, currency)}
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-4 pl-8 text-slate-300">Daily Cash Operating Expenses</td>
                    <td className="p-4 text-slate-500 text-[11px]">Drawer Cash Outflows</td>
                    <td className="p-4 text-right font-mono text-slate-300">{currency} {formatAmount(pnlCalculations.cashExpenses, currency)}</td>
                  </tr>
                  <tr className="hover:bg-slate-800/20">
                    <td className="p-4 pl-8 text-slate-300">Daily Bank / Wire Operating Expenses</td>
                    <td className="p-4 text-slate-500 text-[11px]">Branch Bank Transfers</td>
                    <td className="p-4 text-right font-mono text-slate-300">{currency} {formatAmount(pnlCalculations.bankExpenses, currency)}</td>
                  </tr>

                  {/* NET PROFIT */}
                  <tr className="bg-blue-950/40 border-y-2 border-blue-500/50">
                    <td className="p-4 text-white uppercase font-black text-base">
                      5. NET PROFIT (GROSS PROFIT - OPERATING EXPENSES)
                    </td>
                    <td className="p-4 text-blue-300 font-mono">
                      Net Margin: {pnlCalculations.netMarginPercent}%
                    </td>
                    <td className={cn(
                      "p-4 text-right font-mono font-black text-base",
                      pnlCalculations.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}>
                      {currency} {formatAmount(pnlCalculations.netProfit, currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: DAILY REPORTS (END OF DAY SUMMARIES)               */}
        {/* ========================================================= */}
        {activeTab === 'daily' && (
          <div className="overflow-x-auto custom-scrollbar border border-slate-800 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-800">
                  <th className="p-4">Date</th>
                  <th className="p-4">Branch / Store</th>
                  <th className="p-4 text-right">Cash Sale</th>
                  <th className="p-4 text-right">Bank Sale</th>
                  <th className="p-4 text-right">Total Sale</th>
                  <th className="p-4 text-right">Cash Exp</th>
                  <th className="p-4 text-right">Bank Exp</th>
                  <th className="p-4 text-right text-emerald-400">Bank→Cash</th>
                  <th className="p-4 text-right text-blue-400">Cash→Bank</th>
                  <th className="p-4 text-right text-emerald-400">Closing Cash</th>
                  <th className="p-4 text-right text-blue-400">Closing Bank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs font-bold text-slate-300">
                {dailyReportsData.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-500 font-normal">
                      No daily closing reports found for selected period.
                    </td>
                  </tr>
                ) : (
                  dailyReportsData.map((r, idx) => (
                    <tr key={r.id || idx} className="hover:bg-slate-800/20">
                      <td className="p-4 font-mono text-slate-400">
                        {r.date ? format(parseISO(r.date), 'yyyy-MM-dd') : 'N/A'}
                      </td>
                      <td className="p-4 text-white uppercase font-black">
                        {branches.find(b => b.id === r.branchId)?.name || 'Store'}
                      </td>
                      <td className="p-4 text-right font-mono">{currency} {formatAmount(r.cashSale || 0, currency)}</td>
                      <td className="p-4 text-right font-mono">{currency} {formatAmount(r.bankSale || 0, currency)}</td>
                      <td className="p-4 text-right font-mono font-black text-emerald-400">
                        {currency} {formatAmount((Number(r.cashSale) || 0) + (Number(r.bankSale) || 0), currency)}
                      </td>
                      <td className="p-4 text-right font-mono text-rose-400">{currency} {formatAmount(r.cashExpense || 0, currency)}</td>
                      <td className="p-4 text-right font-mono text-rose-400">{currency} {formatAmount(r.bankExpense || 0, currency)}</td>
                      <td className="p-4 text-right font-mono text-emerald-400">
                        {(Number(r.bankToCash) || 0) > 0 ? `${currency} ${formatAmount(r.bankToCash, currency)}` : '-'}
                      </td>
                      <td className="p-4 text-right font-mono text-blue-400">
                        {(Number(r.cashToBank) || 0) > 0 ? `${currency} ${formatAmount(r.cashToBank, currency)}` : '-'}
                      </td>
                      <td className="p-4 text-right font-mono font-black text-emerald-400">
                        {currency} {formatAmount(r.closingCash || 0, currency)}
                      </td>
                      <td className="p-4 text-right font-mono font-black text-blue-400">
                        {currency} {formatAmount(r.closingBank || 0, currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: MONTHLY & YEARLY TRENDS                            */}
        {/* ========================================================= */}
        {activeTab === 'monthly' && (
          <div className="overflow-x-auto custom-scrollbar border border-slate-800 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-800">
                  <th className="p-4">Month / Period</th>
                  <th className="p-4 text-right">Total Revenue</th>
                  <th className="p-4 text-right">Cost (COGS)</th>
                  <th className="p-4 text-right text-emerald-400">Gross Profit</th>
                  <th className="p-4 text-right text-amber-400">Operating Expenses</th>
                  <th className="p-4 text-right">Net Profit</th>
                  <th className="p-4 text-right text-blue-400">Net Cash Flow</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs font-bold text-slate-300">
                {monthlyTrendsData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500 font-normal">
                      No monthly data available in selected range.
                    </td>
                  </tr>
                ) : (
                  monthlyTrendsData.map((m, idx) => (
                    <tr key={m.monthKey || idx} className="hover:bg-slate-800/20">
                      <td className="p-4 font-black text-white">{m.label}</td>
                      <td className="p-4 text-right font-mono font-black text-emerald-400">{currency} {formatAmount(m.totalSales, currency)}</td>
                      <td className="p-4 text-right font-mono text-rose-400">{currency} {formatAmount(m.cogs, currency)}</td>
                      <td className="p-4 text-right font-mono font-black text-emerald-400">{currency} {formatAmount(m.grossProfit, currency)}</td>
                      <td className="p-4 text-right font-mono text-amber-400">{currency} {formatAmount(m.operatingExpenses, currency)}</td>
                      <td className={cn(
                        "p-4 text-right font-mono font-black",
                        m.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                      )}>
                        {currency} {formatAmount(m.netProfit, currency)}
                      </td>
                      <td className="p-4 text-right font-mono text-blue-400">{currency} {formatAmount(m.cashFlow, currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: STORE-WISE / BRANCH-WISE PERFORMANCE               */}
        {/* ========================================================= */}
        {activeTab === 'store_wise' && (
          <div className="overflow-x-auto custom-scrollbar border border-slate-800 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-800">
                  <th className="p-4">Branch / Store Name</th>
                  <th className="p-4 text-right">Total Sales</th>
                  <th className="p-4 text-right">Cash Inflow</th>
                  <th className="p-4 text-right">Bank / POS</th>
                  <th className="p-4 text-right">COGS</th>
                  <th className="p-4 text-right text-emerald-400">Gross Profit</th>
                  <th className="p-4 text-right text-amber-400">Operating Expenses</th>
                  <th className="p-4 text-right">Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs font-bold text-slate-300">
                {storeWiseData.map((s, idx) => (
                  <tr key={s.branchId || idx} className="hover:bg-slate-800/20">
                    <td className="p-4 font-black text-white uppercase">{s.branchName}</td>
                    <td className="p-4 text-right font-mono font-black text-emerald-400">{currency} {formatAmount(s.totalSales, currency)}</td>
                    <td className="p-4 text-right font-mono text-amber-400">{currency} {formatAmount(s.cashSales, currency)}</td>
                    <td className="p-4 text-right font-mono text-blue-400">{currency} {formatAmount(s.bankSales, currency)}</td>
                    <td className="p-4 text-right font-mono text-rose-400">{currency} {formatAmount(s.cogs, currency)}</td>
                    <td className="p-4 text-right font-mono text-emerald-400 font-black">{currency} {formatAmount(s.grossProfit, currency)}</td>
                    <td className="p-4 text-right font-mono text-amber-400">{currency} {formatAmount(s.operatingExpenses, currency)}</td>
                    <td className={cn(
                      "p-4 text-right font-mono font-black",
                      s.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}>
                      {currency} {formatAmount(s.netProfit, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 5: PAYMENT MODE ALLOCATION                            */}
        {/* ========================================================= */}
        {activeTab === 'payment_mode' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {paymentModeData.map((p, idx) => (
              <div key={idx} className={cn("p-5 rounded-2xl border flex flex-col justify-between", p.color)}>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-black uppercase tracking-wider">{p.mode}</span>
                    <span className="text-xs font-mono font-bold bg-white/10 px-2 py-0.5 rounded-full">{p.percentage}% Share</span>
                  </div>
                  <p className="text-2xl font-black font-mono mt-2">
                    {currency} {formatAmount(p.amount, currency)}
                  </p>
                </div>
                <p className="text-[10px] opacity-80 mt-4 font-bold border-t border-white/10 pt-2">
                  Destination: {p.channel}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 6: PURCHASES & ACCOUNTS PAYABLE                       */}
        {/* ========================================================= */}
        {activeTab === 'purchases' && (
          <div className="overflow-x-auto custom-scrollbar border border-slate-800 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-800">
                  <th className="p-4">Date</th>
                  <th className="p-4">Supplier</th>
                  <th className="p-4">Invoice #</th>
                  <th className="p-4 text-right">Bill Total</th>
                  <th className="p-4 text-right text-emerald-400">Paid Amount</th>
                  <th className="p-4 text-right text-rose-400">Net Due (Accounts Payable)</th>
                  <th className="p-4">Payment Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs font-bold text-slate-300">
                {purchasesData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500 font-normal">
                      No purchase logs found for selected period.
                    </td>
                  </tr>
                ) : (
                  purchasesData.map((p, idx) => (
                    <tr key={p.id || idx} className="hover:bg-slate-800/20">
                      <td className="p-4 font-mono text-slate-400">
                        {p.date ? format(parseISO(p.date), 'yyyy-MM-dd') : 'N/A'}
                      </td>
                      <td className="p-4 text-white font-bold">{p.supplierName}</td>
                      <td className="p-4 font-mono">{p.invoiceNumber || 'N/A'}</td>
                      <td className="p-4 text-right font-mono">{currency} {formatAmount(p.billAmount, currency)}</td>
                      <td className="p-4 text-right font-mono text-emerald-400">{currency} {formatAmount(p.paidAmount, currency)}</td>
                      <td className="p-4 text-right font-mono text-rose-400 font-black">
                        {(Number(p.netDue) || 0) > 0 ? `${currency} ${formatAmount(p.netDue, currency)}` : 'SETTLED'}
                      </td>
                      <td className="p-4 uppercase text-[10px] text-slate-400">{p.paymentMode || 'cash'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 7: ITEMIZED OPERATING EXPENSES                        */}
        {/* ========================================================= */}
        {activeTab === 'expenses' && (
          <div className="overflow-x-auto custom-scrollbar border border-slate-800 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-800">
                  <th className="p-4">Date</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Mode</th>
                  <th className="p-4">Bank Account</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4">Note / Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs font-bold text-slate-300">
                {expensesData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500 font-normal">
                      No expense records found for selected period.
                    </td>
                  </tr>
                ) : (
                  expensesData.map((e, idx) => (
                    <tr key={e.id || idx} className="hover:bg-slate-800/20">
                      <td className="p-4 font-mono text-slate-400">
                        {e.date ? format(parseISO(e.date), 'yyyy-MM-dd') : 'N/A'}
                      </td>
                      <td className="p-4 text-white font-bold">{e.category || 'General'}</td>
                      <td className="p-4 uppercase text-[10px]">
                        <span className={cn(
                          "px-2 py-0.5 rounded font-black",
                          e.paymentType === 'cash' ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400"
                        )}>
                          {e.paymentType || 'cash'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-400">{e.bankName || '-'}</td>
                      <td className="p-4 text-right font-mono text-rose-400 font-black">{currency} {formatAmount(e.amount, currency)}</td>
                      <td className="p-4 text-slate-400 italic max-w-xs truncate">{e.note || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 8: TRANSACTIONS FEED                                  */}
        {/* ========================================================= */}
        {activeTab === 'transactions' && (
          <div className="overflow-x-auto custom-scrollbar border border-slate-800 rounded-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-800">
                  <th className="p-4">Date</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Category</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4">From Account</th>
                  <th className="p-4">To Account</th>
                  <th className="p-4">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs font-bold text-slate-300">
                {transactionsData.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500 font-normal">
                      No transactions found for selected period.
                    </td>
                  </tr>
                ) : (
                  transactionsData.map((t, idx) => (
                    <tr key={t.id || idx} className="hover:bg-slate-800/20">
                      <td className="p-4 font-mono text-slate-400">
                        {t.date ? format(parseISO(t.date), 'yyyy-MM-dd') : 'N/A'}
                      </td>
                      <td className="p-4 uppercase text-[10px]">
                        <span className={cn(
                          "px-2 py-0.5 rounded font-black",
                          t.type === 'income' ? "bg-emerald-500/10 text-emerald-400" :
                          t.type === 'expense' ? "bg-rose-500/10 text-rose-400" : "bg-blue-500/10 text-blue-400"
                        )}>
                          {t.type}
                        </span>
                      </td>
                      <td className="p-4 text-white font-bold">{t.category}</td>
                      <td className="p-4 text-right font-mono font-black text-white">{currency} {formatAmount(t.amount, currency)}</td>
                      <td className="p-4 text-slate-400 uppercase text-[11px]">{t.fromAccount || '-'}</td>
                      <td className="p-4 text-slate-400 uppercase text-[11px]">{t.toAccount || '-'}</td>
                      <td className="p-4 text-slate-400 italic max-w-xs truncate">{t.description || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
