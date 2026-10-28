import React, { useState, useMemo } from 'react';
import { PurchaseLog, Supplier, Branch, Business } from '@/src/types';
import { format, isWithinInterval, startOfDay, endOfDay, parseISO } from 'date-fns';
import { X, Download, FileSpreadsheet, Printer, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { formatAmount } from '@/src/lib/currencyUtils';
import { generatePurchaseReportPdf } from '@/src/lib/pdfUtils';

interface PurchaseReportModalProps {
  logs: PurchaseLog[];
  suppliers: Supplier[];
  branches: Branch[];
  businesses: Business[];
  currency: string;
  onClose: () => void;
  selectedBusiness?: Business | null;
}

export function PurchaseReportModal({
  logs,
  suppliers,
  branches,
  businesses,
  currency,
  onClose,
  selectedBusiness,
}: PurchaseReportModalProps) {
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return format(d, 'yyyy-MM-dd');
  });
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'));
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('all');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Date filter
      if (log.date) {
        try {
          const logDate = parseISO(log.date);
          const start = startOfDay(parseISO(startDate));
          const end = endOfDay(parseISO(endDate));
          if (!isWithinInterval(logDate, { start, end })) {
            return false;
          }
        } catch (e) {
          // ignore parsing error
        }
      }

      // Supplier filter
      if (selectedSupplierId !== 'all' && log.supplierId !== selectedSupplierId) {
        return false;
      }

      // Branch filter
      if (selectedBranchId !== 'all' && log.branchId !== selectedBranchId) {
        return false;
      }

      return true;
    });
  }, [logs, startDate, endDate, selectedSupplierId, selectedBranchId]);

  // Financial totals
  const totals = useMemo(() => {
    return filteredLogs.reduce(
      (acc, log) => {
        const bill = Number(log.billAmount || (log as any).amount || 0);
        const paid = Number(log.paidAmount || 0);
        const due = Number(log.netDue || 0);
        return {
          totalBills: acc.totalBills + 1,
          totalAmount: acc.totalAmount + bill,
          totalPaid: acc.totalPaid + paid,
          totalDue: acc.totalDue + due,
        };
      },
      { totalBills: 0, totalAmount: 0, totalPaid: 0, totalDue: 0 }
    );
  }, [filteredLogs]);

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    if (filteredLogs.length === 0) {
      toast.error('No purchase records to export');
      return;
    }

    try {
      const dataToExport = filteredLogs.map((log, index) => {
        const branchName = branches.find(b => b.id === log.branchId)?.name || 'Main Branch';
        const bill = Number(log.billAmount || (log as any).amount || 0);
        const paid = Number(log.paidAmount || 0);
        const due = Number(log.netDue || 0);

        return {
          'SL': index + 1,
          'Date': log.date ? format(new Date(log.date), 'dd/MM/yyyy') : '',
          'Invoice Number': log.invoiceNumber,
          'Supplier Name': log.supplierName,
          'Branch': branchName,
          [`Bill Amount (${currency})`]: bill,
          [`Paid Amount (${currency})`]: paid,
          [`Net Due (${currency})`]: due,
          'Payment Type': log.paymentType || 'CASH',
          'Items Count': log.items?.length || 0,
        };
      });

      // Append summary row
      dataToExport.push({
        'SL': '' as any,
        'Date': 'TOTAL',
        'Invoice Number': `${totals.totalBills} Bills`,
        'Supplier Name': '',
        'Branch': '',
        [`Bill Amount (${currency})`]: totals.totalAmount,
        [`Paid Amount (${currency})`]: totals.totalPaid,
        [`Net Due (${currency})`]: totals.totalDue,
        'Payment Type': '',
        'Items Count': '' as any,
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Purchase_Report');

      const fileName = `Purchase_Report_${startDate}_to_${endDate}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      toast.success('Excel report downloaded successfully!');
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Failed to export Excel report');
    }
  };

  const handleDownloadPdf = () => {
    generatePurchaseReportPdf({
      logs: filteredLogs,
      startDate,
      endDate,
      business: selectedBusiness,
      branches,
      currency,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl my-8 overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3 text-emerald-400">
            <Download size={22} />
            <div>
              <h2 className="text-base font-black uppercase tracking-wider text-slate-100">
                Purchase Bills Report & Download
              </h2>
              <p className="text-xs text-slate-400">Generate, filter and export supplier purchase statements</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 px-3.5 rounded-xl shadow transition-all cursor-pointer active:scale-95"
              title="Download Excel spreadsheet"
            >
              <FileSpreadsheet size={15} />
              <span>Download Excel</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2.5 px-3.5 rounded-xl shadow transition-all cursor-pointer active:scale-95"
              title="Download vector PDF report"
            >
              <Download size={15} />
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

        {/* Filter Controls (Hidden in print) */}
        <div className="p-6 bg-slate-950/40 border-b border-slate-800/80 space-y-4 print:hidden">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
            <Filter size={14} />
            <span>Filter Criteria</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Supplier
              </label>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 outline-none focus:border-emerald-500"
              >
                <option value="all">All Suppliers ({suppliers.length})</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                Branch
              </label>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-slate-200 outline-none focus:border-emerald-500"
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Report Content (Printable) */}
        <div id="printable-purchase-report" className="flex-1 overflow-y-auto p-6 bg-slate-900 text-slate-200 space-y-6">
          {/* Printable Header */}
          <div className="border-b-2 border-slate-800 pb-4 text-slate-100">
            <h1 className="text-2xl font-black">{selectedBusiness?.name || 'SHOMEDESK BUSINESS'}</h1>
            <p className="text-sm font-bold text-emerald-400 mt-1">Supplier Purchase & Bills Report</p>
            <p className="text-xs text-slate-400">
              Period: {format(parseISO(startDate), 'dd MMM yyyy')} - {format(parseISO(endDate), 'dd MMM yyyy')}
            </p>
          </div>

          {/* Metrics summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Invoices</p>
              <p className="text-xl font-black text-slate-100 mt-1">{totals.totalBills}</p>
            </div>
            <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Purchases</p>
              <p className="text-xl font-black font-mono text-blue-400 mt-1">
                {currency} {formatAmount(totals.totalAmount, currency)}
              </p>
            </div>
            <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Paid</p>
              <p className="text-xl font-black font-mono text-emerald-400 mt-1">
                {currency} {formatAmount(totals.totalPaid, currency)}
              </p>
            </div>
            <div className="p-4 bg-slate-950/60 rounded-2xl border border-slate-800">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Balance Due</p>
              <p className="text-xl font-black font-mono text-rose-400 mt-1">
                {currency} {formatAmount(totals.totalDue, currency)}
              </p>
            </div>
          </div>

          {/* Table */}
          <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/30">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 font-black uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Supplier</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4 text-right">Bill Amount</th>
                  <th className="py-3 px-4 text-right">Paid Amount</th>
                  <th className="py-3 px-4 text-right">Net Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {filteredLogs.map(log => {
                  const billAmt = Number(log.billAmount || (log as any).amount || 0);
                  const paidAmt = Number(log.paidAmount || 0);
                  const netDueAmt = Number(log.netDue || 0);
                  const branchName = branches.find(b => b.id === log.branchId)?.name || 'Main';

                  return (
                    <tr key={log.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {log.date ? format(new Date(log.date), 'dd MMM yyyy') : '-'}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-200">
                        {log.invoiceNumber}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-200">
                        {log.supplierName}
                      </td>
                      <td className="py-3 px-4 text-slate-400">{branchName}</td>
                      <td className="py-3 px-4 text-right font-black font-mono text-blue-400">
                        {currency} {formatAmount(billAmt, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold font-mono text-emerald-400">
                        {currency} {formatAmount(paidAmt, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-black font-mono text-rose-400">
                        {currency} {formatAmount(netDueAmt, currency)}
                      </td>
                    </tr>
                  );
                })}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500 uppercase tracking-widest font-bold">
                      No purchase entries found for this filter
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
