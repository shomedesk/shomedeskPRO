import React, { useRef, useState } from 'react';
import { DailyReport, Business, Branch } from '@/src/types';
import { formatAmount } from '@/src/lib/currencyUtils';
import { generateDailyReportPdf } from '@/src/lib/pdfUtils';
import { format, parseISO } from 'date-fns';
import { 
  X, 
  Download, 
  FileSpreadsheet, 
  Wallet, 
  Landmark, 
  CreditCard, 
  TrendingUp, 
  TrendingDown, 
  FileText,
  DollarSign,
  Sun,
  Moon,
  Coins,
  ArrowRightLeft,
  CheckCircle2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { cn } from '@/src/lib/utils';

interface DailyClosingStatementModalProps {
  report: DailyReport;
  business: Business | null;
  branch: Branch | null;
  currency: string;
  onClose: () => void;
}

export function DailyClosingStatementModal({
  report,
  business,
  branch,
  currency,
  onClose,
}: DailyClosingStatementModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [previewTheme, setPreviewTheme] = useState<'dark' | 'light'>('dark');

  const reportDate = report.date ? parseISO(report.date) : new Date();
  const dateFormatted = format(reportDate, 'dd MMMM yyyy (EEEE)');
  const timeFormatted = format(reportDate, 'hh:mm a');

  // Breakdown calculations
  const cashSale = Number(report.cashSale) || 0;
  const cardSale = Number(report.cardSale) || 0;
  const onlineSale = Number(report.onlineSale) || 0;
  const bankSale = Number(report.bankSale) || 0;
  const calculatedTotalSale = report.totalSale !== undefined 
    ? Number(report.totalSale) 
    : (cashSale + (cardSale > 0 || onlineSale > 0 ? (cardSale + onlineSale) : bankSale));

  // COGS & Gross Profit
  const cogs = Number(report.cogs) || 0;
  const grossProfit = report.grossProfit !== undefined 
    ? Number(report.grossProfit) 
    : (calculatedTotalSale - cogs);
  const grossMargin = calculatedTotalSale > 0 ? ((grossProfit / calculatedTotalSale) * 100).toFixed(1) : '0.0';

  // Expenses & Net Profit
  const cashExp = Number(report.cashExpense) || 0;
  const bankExp = Number(report.bankExpense) || 0;
  const cardExp = Number(report.cardExpense) || 0;
  const totalExpense = report.totalExpense !== undefined 
    ? Number(report.totalExpense) 
    : (cashExp + bankExp + cardExp);

  const netProfit = report.netProfit !== undefined 
    ? Number(report.netProfit) 
    : (grossProfit - totalExpense);
  const netMargin = calculatedTotalSale > 0 ? ((netProfit / calculatedTotalSale) * 100).toFixed(1) : '0.0';

  // Cash reconciliation
  const openingCash = Number(report.openingCash) || 0;
  const bankToCash = Number(report.bankToCash) || 0;
  const cashToBank = Number(report.cashToBank) || 0;
  const closingCash = Number(report.closingCash) || 0;

  // Bank reconciliation
  const openingBank = Number(report.openingBank) || 0;
  const closingBank = Number(report.closingBank) || 0;
  const totalLiquidity = closingCash + closingBank;

  const handleDownloadPdf = () => {
    generateDailyReportPdf({
      report,
      business,
      branch,
      currency,
    });
  };

  const handleExportExcel = () => {
    const rows = [
      ['END OF DAY DAILY CLOSING STATEMENT'],
      ['Store / Business:', business?.name || 'Store'],
      ['Branch:', branch?.name || 'Main Branch'],
      ['Date:', dateFormatted],
      ['Time:', timeFormatted],
      ['Currency:', currency],
      [''],
      ['SECTION', 'METRIC', 'AMOUNT'],
      ['Sales & Revenue', 'Cash Sales (Drawer)', cashSale],
      ['Sales & Revenue', 'Card Sales (POS Machine)', cardSale || (bankSale > 0 && onlineSale === 0 ? bankSale : 0)],
      ['Sales & Revenue', 'Online Bank Sales', onlineSale],
      ['Sales & Revenue', 'TOTAL SALES REVENUE', calculatedTotalSale],
      [''],
      ['Cost of Goods Sold', 'Cost of Products Sold (COGS)', cogs],
      ['Profitability', 'GROSS PROFIT', grossProfit],
      ['Profitability', 'Gross Margin %', `${grossMargin}%`],
      [''],
      ['Operating Expenses', 'Cash Expenses', cashExp],
      ['Operating Expenses', 'Bank Expenses', bankExp],
      ['Operating Expenses', 'Card Expenses', cardExp],
      ['Operating Expenses', 'TOTAL OPERATING EXPENSES', totalExpense],
      [''],
      ['Final Profitability', 'NET PROFIT (GROSS - EXPENSES)', netProfit],
      ['Final Profitability', 'Net Profit Margin %', `${netMargin}%`],
      [''],
      ['Liquidity Reconciliation', 'Opening Cash', openingCash],
      ['Liquidity Reconciliation', 'Closing Cash', closingCash],
      ['Liquidity Reconciliation', 'Opening Bank', openingBank],
      ['Liquidity Reconciliation', 'Closing Bank', closingBank],
      ['Liquidity Reconciliation', 'Total Liquidity', totalLiquidity],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Closing Statement');
    XLSX.writeFile(wb, `Daily_Closing_${branch?.name || 'Store'}_${format(reportDate, 'yyyyMMdd')}.xlsx`);
  };

  const isDark = previewTheme === 'dark';

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-6 overflow-hidden animate-in fade-in duration-200">
      <div className="bg-[#0F172A] border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 border-b border-slate-800 bg-[#1E293B] shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
              <FileText size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                  Daily Closing Statement
                </h3>
                <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  Z-Report
                </span>
              </div>
              <p className="text-[10px] sm:text-xs text-slate-400 font-medium">
                {branch?.name || 'Main Branch'} • {dateFormatted}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Dark / Light Sheet Preview Toggle */}
            <button
              type="button"
              onClick={() => setPreviewTheme(isDark ? 'light' : 'dark')}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2 px-3 rounded-xl border border-slate-700 transition-all cursor-pointer active:scale-95"
              title="Toggle preview sheet contrast mode"
            >
              {isDark ? (
                <>
                  <Sun size={14} className="text-amber-400" />
                  <span className="hidden sm:inline">Light Mode</span>
                </>
              ) : (
                <>
                  <Moon size={14} className="text-blue-400" />
                  <span className="hidden sm:inline">Dark Mode</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2 px-3 rounded-xl border border-slate-700 transition-all cursor-pointer active:scale-95"
            >
              <FileSpreadsheet size={15} className="text-emerald-400" />
              <span className="hidden xs:inline">Excel</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-black py-2 px-3.5 rounded-xl shadow-lg shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
              title="Download colorful vector PDF"
            >
              <Download size={15} />
              <span>Download PDF</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white p-2 rounded-xl transition-all cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Document Area */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 bg-black/40 flex justify-center">
          <div 
            ref={printRef}
            id="daily-closing-sheet" 
            className={cn(
              "w-full max-w-3xl p-5 sm:p-8 space-y-5 rounded-2xl sm:rounded-3xl shadow-2xl transition-all font-sans border",
              isDark 
                ? "bg-[#1E293B] text-slate-100 border-slate-700/80" 
                : "bg-white text-slate-900 border-slate-200 shadow-xl"
            )}
          >
            {/* Header Banner */}
            <div className={cn(
              "pb-4 flex flex-wrap justify-between items-start gap-4 border-b-2",
              isDark ? "border-slate-700" : "border-slate-900"
            )}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-6 bg-emerald-500 rounded-full" />
                  <h1 className={cn("text-xl sm:text-2xl font-black tracking-tight uppercase", isDark ? "text-white" : "text-slate-950")}>
                    {business?.name || 'SHOMEDESK RETAIL ERP'}
                  </h1>
                </div>
                <p className={cn("text-xs font-bold pl-4", isDark ? "text-slate-300" : "text-slate-700")}>
                  Branch: <span className="text-emerald-400">{branch?.name || 'Main Branch'}</span> {branch?.branchCode ? `(${branch.branchCode})` : ''} • {branch?.location || 'Central Location'}
                </p>
                {business?.mobileNumber && (
                  <p className={cn("text-[11px] pl-4 font-medium", isDark ? "text-slate-400" : "text-slate-500")}>
                    Support / Mobile: {business.mobileNumber}
                  </p>
                )}
              </div>

              <div className="text-right">
                <span className="inline-block bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg mb-1 shadow-sm">
                  Daily Closing Z-Report
                </span>
                <p className={cn("text-xs font-mono font-bold", isDark ? "text-slate-200" : "text-slate-800")}>
                  {dateFormatted}
                </p>
                <p className={cn("text-[10px] font-medium", isDark ? "text-slate-400" : "text-slate-500")}>
                  Closed At: {timeFormatted}
                </p>
              </div>
            </div>

            {/* Financial Summary Highlight Banner (4 Colorful Stat Cards) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <div className={cn(
                "p-3 rounded-2xl border text-center transition-all",
                isDark ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-400" : "bg-emerald-50 border-emerald-300 text-emerald-900"
              )}>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-80">Total Sales</p>
                <p className="text-base sm:text-lg font-black font-mono mt-0.5 text-emerald-500">
                  {currency} {formatAmount(calculatedTotalSale, currency)}
                </p>
                <span className="text-[9px] font-bold opacity-70">Gross Revenue</span>
              </div>

              <div className={cn(
                "p-3 rounded-2xl border text-center transition-all",
                isDark ? "bg-slate-800/60 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-300 text-slate-800"
              )}>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-80">Cost of Goods (COGS)</p>
                <p className="text-base sm:text-lg font-black font-mono mt-0.5 text-rose-400">
                  {currency} {formatAmount(cogs, currency)}
                </p>
                <span className="text-[9px] font-bold opacity-70">Product Costs</span>
              </div>

              <div className={cn(
                "p-3 rounded-2xl border text-center transition-all",
                isDark ? "bg-rose-950/30 border-rose-500/30 text-rose-400" : "bg-rose-50 border-rose-300 text-rose-900"
              )}>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-80">Total Expenses</p>
                <p className="text-base sm:text-lg font-black font-mono mt-0.5 text-rose-500">
                  {currency} {formatAmount(totalExpense, currency)}
                </p>
                <span className="text-[9px] font-bold opacity-70">Cash & Bank</span>
              </div>

              <div className={cn(
                "p-3 rounded-2xl border text-center transition-all",
                isDark ? "bg-blue-950/30 border-blue-500/30 text-blue-400" : "bg-blue-50 border-blue-300 text-blue-900"
              )}>
                <p className="text-[9px] font-black uppercase tracking-wider opacity-80">Net Profit</p>
                <p className={cn("text-base sm:text-lg font-black font-mono mt-0.5", netProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {currency} {formatAmount(netProfit, currency)}
                </p>
                <span className="text-[9px] font-bold opacity-80">Margin: {netMargin}%</span>
              </div>
            </div>

            {/* Section 1: Sales & Revenue Breakdown */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-lg">
                  <Wallet size={14} />
                </div>
                <h2 className={cn("text-xs font-black uppercase tracking-wider", isDark ? "text-white" : "text-slate-900")}>
                  1. Sales & Revenue Breakdown (By Channel)
                </h2>
              </div>

              <div className={cn(
                "rounded-xl border overflow-hidden",
                isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"
              )}>
                <table className="w-full text-left text-xs border-collapse">
                  <thead className={cn(
                    "text-[10px] uppercase font-bold border-b",
                    isDark ? "bg-slate-800 text-slate-300 border-slate-700" : "bg-slate-100 text-slate-700 border-slate-200"
                  )}>
                    <tr>
                      <th className="py-2.5 px-3.5">Payment Channel</th>
                      <th className="py-2.5 px-3.5">Destination Account</th>
                      <th className="py-2.5 px-3.5 text-right">Amount ({currency})</th>
                      <th className="py-2.5 px-3.5 text-right">Share %</th>
                    </tr>
                  </thead>
                  <tbody className={cn("divide-y", isDark ? "divide-slate-800" : "divide-slate-100")}>
                    <tr>
                      <td className="py-2.5 px-3.5 font-bold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-400" />
                        Cash Sales
                      </td>
                      <td className={cn("py-2.5 px-3.5 text-[11px]", isDark ? "text-slate-400" : "text-slate-600")}>
                        Store Cash Drawer
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono font-bold text-amber-400">
                        {formatAmount(cashSale, currency)}
                      </td>
                      <td className={cn("py-2.5 px-3.5 text-right text-[11px] font-medium", isDark ? "text-slate-400" : "text-slate-500")}>
                        {calculatedTotalSale > 0 ? `${((cashSale / calculatedTotalSale) * 100).toFixed(1)}%` : '0%'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3.5 font-bold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-400" />
                        Card Sales (Debit/Credit)
                      </td>
                      <td className={cn("py-2.5 px-3.5 text-[11px]", isDark ? "text-slate-400" : "text-slate-600")}>
                        POS Terminal / Settlement Account
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono font-bold text-blue-400">
                        {formatAmount(cardSale || (bankSale > 0 && onlineSale === 0 ? bankSale : 0), currency)}
                      </td>
                      <td className={cn("py-2.5 px-3.5 text-right text-[11px] font-medium", isDark ? "text-slate-400" : "text-slate-500")}>
                        {calculatedTotalSale > 0 ? `${(((cardSale || bankSale) / calculatedTotalSale) * 100).toFixed(1)}%` : '0%'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3.5 font-bold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-sky-400" />
                        Online Bank Sales
                      </td>
                      <td className={cn("py-2.5 px-3.5 text-[11px]", isDark ? "text-slate-400" : "text-slate-600")}>
                        Direct Bank Account Deposit
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono font-bold text-sky-400">
                        {formatAmount(onlineSale, currency)}
                      </td>
                      <td className={cn("py-2.5 px-3.5 text-right text-[11px] font-medium", isDark ? "text-slate-400" : "text-slate-500")}>
                        {calculatedTotalSale > 0 ? `${((onlineSale / calculatedTotalSale) * 100).toFixed(1)}%` : '0%'}
                      </td>
                    </tr>
                    <tr className={cn(
                      "font-black border-t-2",
                      isDark ? "bg-slate-800/80 border-slate-700 text-white" : "bg-slate-100 border-slate-300 text-slate-950"
                    )}>
                      <td colSpan={2} className="py-2.5 px-3.5 uppercase text-[11px] tracking-wider text-emerald-400">
                        Total Gross Sales Revenue
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono text-sm text-emerald-400">
                        {currency} {formatAmount(calculatedTotalSale, currency)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right">100.0%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 2: Trading Profit & Cost of Goods Sold */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/20 text-blue-400 rounded-lg">
                  <TrendingUp size={14} />
                </div>
                <h2 className={cn("text-xs font-black uppercase tracking-wider", isDark ? "text-white" : "text-slate-900")}>
                  2. Trading Profit & Cost of Goods Sold (COGS)
                </h2>
              </div>

              <div className={cn(
                "rounded-xl border overflow-hidden",
                isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"
              )}>
                <table className="w-full text-left text-xs border-collapse">
                  <tbody className={cn("divide-y", isDark ? "divide-slate-800" : "divide-slate-100")}>
                    <tr>
                      <td className="py-2 px-3.5 font-medium">Total Sales Revenue (+)</td>
                      <td className="py-2 px-3.5 text-right font-mono font-bold text-emerald-400">
                        {currency} {formatAmount(calculatedTotalSale, currency)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3.5 font-medium text-rose-400">Less: Cost of Total Products Sold (COGS) (-)</td>
                      <td className="py-2 px-3.5 text-right font-mono font-bold text-rose-400">
                        - {currency} {formatAmount(cogs, currency)}
                      </td>
                    </tr>
                    <tr className={cn(
                      "font-black border-t",
                      isDark ? "bg-emerald-950/20 border-slate-700 text-emerald-300" : "bg-emerald-50 border-slate-200 text-emerald-900"
                    )}>
                      <td className="py-2 px-3.5">(=) GROSS PROFIT (Revenue - COGS)</td>
                      <td className="py-2 px-3.5 text-right font-mono text-sm font-black text-emerald-400">
                        {currency} {formatAmount(grossProfit, currency)} ({grossMargin}%)
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3.5 font-medium text-rose-400">Less: Total Operating Expenses (-)</td>
                      <td className="py-2 px-3.5 text-right font-mono font-bold text-rose-400">
                        - {currency} {formatAmount(totalExpense, currency)}
                      </td>
                    </tr>
                    <tr className={cn(
                      "font-black border-t-2",
                      isDark ? "bg-blue-950/30 border-blue-500/40 text-blue-300" : "bg-blue-50 border-blue-300 text-blue-900"
                    )}>
                      <td className="py-2.5 px-3.5 uppercase text-[11px] tracking-wider text-blue-400">
                        (=) NET PROFIT FOR TODAY
                      </td>
                      <td className={cn("py-2.5 px-3.5 text-right font-mono text-sm font-black", netProfit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {currency} {formatAmount(netProfit, currency)} ({netMargin}%)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 3 & 4: Operating Expenses & Cash/Bank Reconciliation */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Expenses Breakdown */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-rose-500/20 text-rose-400 rounded-lg">
                    <TrendingDown size={14} />
                  </div>
                  <h3 className={cn("text-xs font-black uppercase tracking-wider", isDark ? "text-white" : "text-slate-900")}>
                    3. Operating Expenses
                  </h3>
                </div>

                <div className={cn(
                  "border rounded-2xl p-3.5 text-xs space-y-2",
                  isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-slate-50"
                )}>
                  <div className="flex justify-between items-center">
                    <span className={cn(isDark ? "text-slate-400" : "text-slate-600")}>Cash Expenses:</span>
                    <span className="font-mono font-bold text-rose-400">{currency} {formatAmount(cashExp, currency)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={cn(isDark ? "text-slate-400" : "text-slate-600")}>Bank / Online Expenses:</span>
                    <span className="font-mono font-bold text-rose-400">{currency} {formatAmount(bankExp, currency)}</span>
                  </div>
                  {cardExp > 0 && (
                    <div className="flex justify-between items-center">
                      <span className={cn(isDark ? "text-slate-400" : "text-slate-600")}>Card Expenses:</span>
                      <span className="font-mono font-bold text-rose-400">{currency} {formatAmount(cardExp, currency)}</span>
                    </div>
                  )}

                  {report.expenseItems && report.expenseItems.length > 0 && (
                    <div className={cn("pt-2 border-t space-y-1.5", isDark ? "border-slate-800" : "border-slate-200")}>
                      <p className="text-[9px] uppercase font-bold text-slate-500">Itemized Breakdown:</p>
                      {report.expenseItems.slice(0, 4).map((exp, idx) => (
                        <div key={idx} className="flex justify-between text-[11px]">
                          <span className={cn("truncate max-w-[160px]", isDark ? "text-slate-300" : "text-slate-600")}>
                            {exp.category} {exp.note ? `(${exp.note})` : ''}
                          </span>
                          <span className="font-mono font-semibold text-rose-400">{formatAmount(exp.amount, currency)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className={cn(
                    "flex justify-between pt-2 border-t font-black text-rose-400",
                    isDark ? "border-slate-700" : "border-slate-300"
                  )}>
                    <span>Total Operating Expenses:</span>
                    <span className="font-mono">{currency} {formatAmount(totalExpense, currency)}</span>
                  </div>
                </div>
              </div>

              {/* Cash & Bank Drawer Reconciliation */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-500/20 text-indigo-400 rounded-lg">
                    <Landmark size={14} />
                  </div>
                  <h3 className={cn("text-xs font-black uppercase tracking-wider", isDark ? "text-white" : "text-slate-900")}>
                    4. Liquidity & Drawer Reconciliation
                  </h3>
                </div>

                <div className={cn(
                  "border rounded-2xl p-3.5 text-xs space-y-2",
                  isDark ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-slate-50"
                )}>
                  <div className="flex justify-between items-center">
                    <span className={cn(isDark ? "text-slate-400" : "text-slate-600")}>Opening Cash Drawer:</span>
                    <span className="font-mono font-bold text-slate-300">{currency} {formatAmount(openingCash, currency)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={cn(isDark ? "text-slate-400" : "text-slate-600")}>Opening Bank Accounts:</span>
                    <span className="font-mono font-bold text-slate-300">{currency} {formatAmount(openingBank, currency)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={cn(isDark ? "text-slate-400" : "text-slate-600")}>Deposits (Cash → Bank):</span>
                    <span className="font-mono font-bold text-blue-400">{currency} {formatAmount(cashToBank, currency)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={cn(isDark ? "text-slate-400" : "text-slate-600")}>Withdrawals (Bank → Cash):</span>
                    <span className="font-mono font-bold text-emerald-400">{currency} {formatAmount(bankToCash, currency)}</span>
                  </div>

                  <div className={cn(
                    "flex justify-between items-center pt-2 border-t font-black rounded-lg px-2 py-1",
                    isDark ? "bg-amber-500/10 text-amber-300 border-slate-700" : "bg-amber-50 text-amber-900 border-slate-200"
                  )}>
                    <span>Closing Cash in Drawer:</span>
                    <span className="font-mono text-amber-400">{currency} {formatAmount(closingCash, currency)}</span>
                  </div>

                  <div className={cn(
                    "flex justify-between items-center font-black rounded-lg px-2 py-1",
                    isDark ? "bg-blue-500/10 text-blue-300" : "bg-blue-50 text-blue-900"
                  )}>
                    <span>Closing Bank Accounts:</span>
                    <span className="font-mono text-blue-400">{currency} {formatAmount(closingBank, currency)}</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Note & Remarks */}
            {report.note && (
              <div className={cn(
                "p-3.5 rounded-2xl border text-xs",
                isDark ? "bg-slate-900/60 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
              )}>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Closing Notes & Remarks:</p>
                <p className="italic">{report.note}</p>
              </div>
            )}

            {/* Certification Signatures */}
            <div className={cn(
              "pt-6 border-t-2 grid grid-cols-2 gap-8 text-center text-xs",
              isDark ? "border-slate-700 text-slate-400" : "border-slate-900 text-slate-600"
            )}>
              <div className={cn("border-t pt-2 mt-4", isDark ? "border-slate-700" : "border-slate-300")}>
                <p className={cn("font-black", isDark ? "text-white" : "text-slate-900")}>Branch Cashier / Store Manager</p>
                <p className="text-[10px] text-slate-500">Signature & Handover Date</p>
              </div>
              <div className={cn("border-t pt-2 mt-4", isDark ? "border-slate-700" : "border-slate-300")}>
                <p className={cn("font-black", isDark ? "text-white" : "text-slate-900")}>Authorized Owner / Auditor</p>
                <p className="text-[10px] text-slate-500">Verification Stamp & Signature</p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
