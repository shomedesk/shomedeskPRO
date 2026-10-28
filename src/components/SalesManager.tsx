import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  deleteDoc, 
  doc, 
  updateDoc, 
  increment 
} from 'firebase/firestore';
import { 
  SaleInvoice, 
  SaleItem, 
  SalesPlayProduct, 
  Branch, 
  Business, 
  BankAccount 
} from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { formatAmount, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import { downloadElementAsPdf } from '@/src/lib/pdfUtils';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { 
  Receipt, 
  Plus, 
  Search, 
  Calendar, 
  Filter, 
  Download, 
  Printer, 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  Landmark, 
  CreditCard, 
  Eye, 
  Trash2, 
  RefreshCw, 
  X, 
  CheckCircle2, 
  ShoppingBag, 
  Barcode as BarcodeIcon, 
  FileSpreadsheet, 
  DollarSign, 
  ArrowUpRight,
  Store
} from 'lucide-react';
import { Barcode } from './Barcode';
import { SalesPlaySyncModal } from './SalesPlaySyncModal';
import { fetchSalesPlayProductsWithInventory, syncSalesPlaySalesToFirestore } from '@/src/services/salesplay';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { cn } from '@/src/lib/utils';

export default function SalesManager() {
  const { 
    selectedBusiness, 
    selectedBranch, 
    branches, 
    bankAccounts, 
    isAllBusinessesSelected, 
    businesses, 
    userProfile 
  } = useBusiness();

  const isAdmin = userProfile?.role === 'admin' || auth.currentUser?.email === 'shomedesk@gmail.com';
  const currency = isAllBusinessesSelected 
    ? 'OMR' 
    : (selectedBranch?.currency || selectedBusiness?.currency || 'OMR');

  const [invoices, setInvoices] = useState<SaleInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<string>('all');
  const [dateFilterMode, setDateFilterMode] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today');
  const [customStartDate, setCustomStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Modals
  const [isNewSaleModalOpen, setIsNewSaleModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [viewingInvoice, setViewingInvoice] = useState<SaleInvoice | null>(null);
  const [isSyncingSales, setIsSyncingSales] = useState(false);

  // Direct Live Sync from SalesPlay POS
  const handleSyncSalesPlaySales = async () => {
    const biz = selectedBusiness || (businesses.length > 0 ? businesses[0] : null);
    if (!biz) {
      toast.error('Please select a business first');
      return;
    }

    setIsSyncingSales(true);
    const toastId = toast.loading('Connecting to SalesPlay POS and fetching latest receipts...');

    try {
      const today = new Date();
      let start: Date;
      let end: Date = endOfDay(today);

      if (dateFilterMode === 'today') {
        start = startOfDay(today);
      } else if (dateFilterMode === 'yesterday') {
        const y = subDays(today, 1);
        start = startOfDay(y);
        end = endOfDay(y);
      } else if (dateFilterMode === 'week') {
        start = startOfDay(subDays(today, 7));
      } else if (dateFilterMode === 'month') {
        start = startOfMonth(today);
        end = endOfMonth(today);
      } else if (dateFilterMode === 'custom' && customStartDate && customEndDate) {
        start = startOfDay(parseISO(customStartDate));
        end = endOfDay(parseISO(customEndDate));
      } else {
        // Default to last 30 days
        start = subDays(today, 29);
      }

      const res = await syncSalesPlaySalesToFirestore({
        businessId: biz.id,
        ownerId: biz.ownerId || auth.currentUser?.uid || '',
        branchId: selectedBranch?.id || 'main',
        startDate: start,
        endDate: end,
      });

      if (res.success) {
        // Also refresh catalog products so any new items entered in SalesPlay are immediately available
        fetchSalesPlayProductsWithInventory(undefined, undefined, true).then(prods => {
          if (prods && prods.length > 0) setCatalogProducts(prods);
        }).catch(() => {});

        toast.success(
          `Synced ${res.importedCount} sales! Total: ${currency} ${formatAmount(res.totalSales, currency)} (COGS: ${currency} ${formatAmount(res.totalCogs, currency)} | Gross Profit: ${currency} ${formatAmount(res.grossProfit, currency)})`,
          { id: toastId, duration: 6000 }
        );
      } else {
        toast.info(res.message, { id: toastId });
      }
    } catch (err: any) {
      console.error('Failed to sync sales from SalesPlay:', err);
      toast.error(err?.message || 'Failed to sync sales from SalesPlay POS', { id: toastId });
    } finally {
      setIsSyncingSales(false);
    }
  };

  // Products for autocomplete
  const [catalogProducts, setCatalogProducts] = useState<SalesPlayProduct[]>([]);

  // Load SalesPlay Products for rapid sale invoice lookup
  useEffect(() => {
    async function loadProducts() {
      if (!selectedBusiness && !isAllBusinessesSelected) return;
      try {
        const prods = await fetchSalesPlayProductsWithInventory();
        setCatalogProducts(prods);
      } catch (err) {
        console.warn('Notice loading products for sales:', err);
      }
    }
    loadProducts();
  }, [selectedBusiness, isAllBusinessesSelected]);

  // Listen to Sales Invoices
  useEffect(() => {
    if (!selectedBusiness && !isAllBusinessesSelected) return;

    let q;
    if (isAllBusinessesSelected) {
      q = query(
        collection(db, 'sales'),
        orderBy('date', 'desc')
      );
    } else {
      q = query(
        collection(db, 'sales'),
        where('businessId', '==', selectedBusiness!.id),
        ...(selectedBranch ? [where('branchId', '==', selectedBranch.id)] : []),
        orderBy('date', 'desc')
      );
    }

    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as SaleInvoice));
      setInvoices(list);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'sales');
      setLoading(false);
    });

    return () => unsub();
  }, [selectedBusiness, selectedBranch, isAllBusinessesSelected]);

  // Date Filtering
  const filteredInvoices = useMemo(() => {
    const today = new Date();
    let start: Date;
    let end: Date = endOfDay(today);

    if (dateFilterMode === 'today') {
      start = startOfDay(today);
    } else if (dateFilterMode === 'yesterday') {
      const y = subDays(today, 1);
      start = startOfDay(y);
      end = endOfDay(y);
    } else if (dateFilterMode === 'week') {
      start = startOfDay(subDays(today, 7));
    } else if (dateFilterMode === 'month') {
      start = startOfMonth(today);
      end = endOfMonth(today);
    } else {
      start = startOfDay(parseISO(customStartDate));
      end = endOfDay(parseISO(customEndDate));
    }

    return invoices.filter(inv => {
      // 1. Date check
      const invDate = inv.date ? parseISO(inv.date) : new Date();
      const inRange = isWithinInterval(invDate, { start, end });
      if (!inRange) return false;

      // 2. Payment mode check
      if (paymentFilter !== 'all' && inv.paymentMode.toLowerCase() !== paymentFilter.toLowerCase()) {
        return false;
      }

      // 3. Search term check
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const matchesInv = inv.invoiceNumber?.toLowerCase().includes(term);
        const matchesCust = inv.customerName?.toLowerCase().includes(term) || inv.customerPhone?.includes(term);
        const matchesItem = inv.items?.some(i => i.name.toLowerCase().includes(term) || i.barcode?.includes(term));
        if (!matchesInv && !matchesCust && !matchesItem) return false;
      }

      return true;
    });
  }, [invoices, dateFilterMode, customStartDate, customEndDate, paymentFilter, searchTerm]);

  // Calculate High-Standard ERP Financial Metrics (Vyapar Style)
  const metrics = useMemo(() => {
    let totalSale = 0;
    let cashSale = 0;
    let cardSale = 0;
    let onlineSale = 0;
    let totalCogs = 0; // Cost of Goods Sold

    filteredInvoices.forEach(inv => {
      const amt = Number(inv.totalAmount) || 0;
      totalSale += amt;

      const pMode = (inv.paymentMode || '').toLowerCase();
      if (pMode === 'cash') {
        cashSale += amt;
      } else if (pMode === 'card') {
        cardSale += amt;
      } else if (pMode === 'online') {
        onlineSale += amt;
      } else {
        // Handle split if provided
        cashSale += Number(inv.cashAmount) || 0;
        cardSale += Number(inv.cardAmount) || 0;
        onlineSale += Number(inv.onlineAmount) || 0;
      }

      totalCogs += Number(inv.totalCost) || 0;
    });

    const grossProfit = totalSale - totalCogs;
    const grossMarginPercent = totalSale > 0 ? (grossProfit / totalSale) * 100 : 0;

    return {
      totalSale: toStrictDecimal3(totalSale),
      cashSale: toStrictDecimal3(cashSale),
      cardSale: toStrictDecimal3(cardSale),
      onlineSale: toStrictDecimal3(onlineSale),
      totalCogs: toStrictDecimal3(totalCogs),
      grossProfit: toStrictDecimal3(grossProfit),
      grossMarginPercent: grossMarginPercent.toFixed(1),
      count: filteredInvoices.length
    };
  }, [filteredInvoices]);

  // Export to Excel / CSV
  const handleExportExcel = () => {
    if (filteredInvoices.length === 0) {
      toast.error('No sales data to export for this range');
      return;
    }

    const rows = filteredInvoices.map((inv, idx) => ({
      '#': idx + 1,
      'Invoice Number': inv.invoiceNumber,
      'Date': inv.date ? format(parseISO(inv.date), 'yyyy-MM-dd HH:mm') : '',
      'Customer': inv.customerName || 'Walk-in Customer',
      'Phone': inv.customerPhone || '',
      'Payment Mode': inv.paymentMode,
      'Items Count': inv.items?.length || 0,
      [`Total Sale (${currency})`]: inv.totalAmount,
      [`COGS Cost (${currency})`]: inv.totalCost,
      [`Gross Profit (${currency})`]: inv.grossProfit,
      'Profit Margin %': inv.grossProfitMargin ? `${inv.grossProfitMargin.toFixed(1)}%` : '0%',
      'Source': inv.source || 'POS',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Invoices');
    XLSX.writeFile(wb, `Sales_Report_${selectedBusiness?.name || 'Store'}_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    toast.success('Sales report exported to Excel');
  };

  // Admin Delete Sale Invoice
  const handleDeleteInvoice = async (inv: SaleInvoice) => {
    if (!inv.id || !isAdmin) return;
    if (!confirm(`Are you sure you want to delete Invoice #${inv.invoiceNumber}? This will reverse recorded bank receipts.`)) return;

    try {
      // 1. Reverse bank account balance if card or online
      if (inv.bankId && (inv.paymentMode === 'Card' || inv.paymentMode === 'Online')) {
        try {
          await updateDoc(doc(db, 'bankAccounts', inv.bankId), {
            balance: increment(-inv.totalAmount)
          });
        } catch (bErr) {
          console.warn('Bank reverse notice:', bErr);
        }
      }

      // 2. Delete invoice
      await deleteDoc(doc(db, 'sales', inv.id));
      toast.success(`Invoice #${inv.invoiceNumber} deleted successfully`);
      if (viewingInvoice?.id === inv.id) setViewingInvoice(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `sales/${inv.id}`);
      toast.error('Failed to delete sale invoice');
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
            <Receipt size={28} />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
              Sales & POS Invoices
              <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                Vyapar ERP System
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {isAllBusinessesSelected 
                ? 'Global sales records across all branches' 
                : `${selectedBusiness?.name || 'Business'} • ${selectedBranch?.name || 'Central Store'} (${currency})`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isSyncingSales}
            onClick={handleSyncSalesPlaySales}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-lg shadow-blue-900/30 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            title="Import all sales & receipts directly from SalesPlay POS"
          >
            <RefreshCw size={15} className={cn("text-white", isSyncingSales && "animate-spin")} />
            <span>{isSyncingSales ? 'Importing Sales...' : '⚡ Sync SalesPlay Sales'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 px-3.5 rounded-xl border border-slate-700 transition-all cursor-pointer active:scale-95"
            title="Configure shop mapping and POS settings"
          >
            <Store size={15} className="text-emerald-400" />
            <span>POS Settings</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 px-3.5 rounded-xl border border-slate-700 transition-all cursor-pointer active:scale-95"
            title="Export filtered sales to Excel"
          >
            <FileSpreadsheet size={15} className="text-emerald-400" />
            <span>Export Excel</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewSaleModalOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
          >
            <Plus size={16} />
            <span>+ New Sale</span>
          </button>
        </div>
      </div>

      {/* Vyapar-Grade KPI Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 md:gap-4">
        {/* Total Sales */}
        <div className="col-span-2 sm:col-span-1 bg-gradient-to-br from-slate-900 to-slate-950 p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Total Sales</span>
            <ShoppingBag size={15} className="text-emerald-400" />
          </div>
          <p className="text-xl md:text-2xl font-black font-mono text-emerald-400">
            {currency} {formatAmount(metrics.totalSale, currency)}
          </p>
          <p className="text-[10px] text-slate-500 font-bold mt-1">
            {metrics.count} {metrics.count === 1 ? 'Invoice' : 'Invoices'}
          </p>
        </div>

        {/* Cash Sales */}
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Cash Sales</span>
            <Wallet size={15} className="text-amber-400" />
          </div>
          <p className="text-lg md:text-xl font-black font-mono text-amber-400">
            {currency} {formatAmount(metrics.cashSale, currency)}
          </p>
          <span className="text-[9px] font-bold text-slate-500">In Hand Drawer</span>
        </div>

        {/* Card Sales */}
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Card Sales</span>
            <CreditCard size={15} className="text-indigo-400" />
          </div>
          <p className="text-lg md:text-xl font-black font-mono text-indigo-400">
            {currency} {formatAmount(metrics.cardSale, currency)}
          </p>
          <span className="text-[9px] font-bold text-slate-500">Bank POS Terminal</span>
        </div>

        {/* Online / Bank Sales */}
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Online Sales</span>
            <Landmark size={15} className="text-blue-400" />
          </div>
          <p className="text-lg md:text-xl font-black font-mono text-blue-400">
            {currency} {formatAmount(metrics.onlineSale, currency)}
          </p>
          <span className="text-[9px] font-bold text-slate-500">Direct Bank Transfer</span>
        </div>

        {/* COGS (Cost of Goods Sold) */}
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Cost (COGS)</span>
            <TrendingDown size={15} className="text-rose-400" />
          </div>
          <p className="text-lg md:text-xl font-black font-mono text-rose-400">
            {currency} {formatAmount(metrics.totalCogs, currency)}
          </p>
          <span className="text-[9px] font-bold text-slate-500">Product Purchase Cost</span>
        </div>

        {/* Gross Profit & Margin */}
        <div className="col-span-2 sm:col-span-1 bg-emerald-950/20 p-4 rounded-2xl border border-emerald-500/30">
          <div className="flex items-center justify-between text-emerald-300 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider">Gross Profit</span>
            <span className="text-[10px] font-black font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
              +{metrics.grossMarginPercent}%
            </span>
          </div>
          <p className="text-xl md:text-2xl font-black font-mono text-emerald-300">
            {currency} {formatAmount(metrics.grossProfit, currency)}
          </p>
          <span className="text-[9px] font-bold text-emerald-500/80">Revenue - COGS</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        {/* Date Mode Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDateFilterMode('today')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
              dateFilterMode === 'today' ? "bg-blue-600 text-white shadow" : "bg-slate-900 text-slate-400 hover:text-slate-200"
            )}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDateFilterMode('yesterday')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
              dateFilterMode === 'yesterday' ? "bg-blue-600 text-white shadow" : "bg-slate-900 text-slate-400 hover:text-slate-200"
            )}
          >
            Yesterday
          </button>
          <button
            type="button"
            onClick={() => setDateFilterMode('week')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
              dateFilterMode === 'week' ? "bg-blue-600 text-white shadow" : "bg-slate-900 text-slate-400 hover:text-slate-200"
            )}
          >
            Last 7 Days
          </button>
          <button
            type="button"
            onClick={() => setDateFilterMode('month')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
              dateFilterMode === 'month' ? "bg-blue-600 text-white shadow" : "bg-slate-900 text-slate-400 hover:text-slate-200"
            )}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={() => setDateFilterMode('custom')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer",
              dateFilterMode === 'custom' ? "bg-blue-600 text-white shadow" : "bg-slate-900 text-slate-400 hover:text-slate-200"
            )}
          >
            Custom Range
          </button>

          {dateFilterMode === 'custom' && (
            <div className="flex items-center gap-1.5 ml-1">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white text-xs px-2.5 py-1.5 rounded-xl outline-none"
              />
              <span className="text-slate-500 text-xs">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white text-xs px-2.5 py-1.5 rounded-xl outline-none"
              />
            </div>
          )}
        </div>

        {/* Payment mode filter & Search */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-slate-300 font-bold px-3 py-2 rounded-xl outline-none"
          >
            <option value="all">All Payment Modes</option>
            <option value="cash">Cash Only</option>
            <option value="card">Card Only</option>
            <option value="online">Online Bank</option>
          </select>

          <div className="relative flex-1 sm:w-60">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search invoice, customer, item..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Sales Invoices List */}
      <div className="bg-[#1E293B] rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Receipt size={16} className="text-emerald-400" />
            Itemized Sales Invoices ({filteredInvoices.length})
          </h2>
          <span className="text-[11px] font-bold text-slate-500">
            Period: {dateFilterMode.toUpperCase()}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800 text-[10px] font-black uppercase tracking-wider">
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4 text-center">Items</th>
                <th className="py-3 px-4 text-right">Sale Total ({currency})</th>
                <th className="py-3 px-4 text-right">COGS Cost ({currency})</th>
                <th className="py-3 px-4 text-right">Gross Profit ({currency})</th>
                <th className="py-3 px-4 text-right">Margin %</th>
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-100">
                    #{inv.invoiceNumber}
                  </td>
                  <td className="py-3.5 px-4 text-slate-400">
                    {inv.date ? format(parseISO(inv.date), 'dd MMM yyyy, HH:mm') : 'N/A'}
                  </td>
                  <td className="py-3.5 px-4">
                    <p className="font-bold text-slate-200">{inv.customerName || 'Walk-in Customer'}</p>
                    {inv.customerPhone && (
                      <p className="text-[10px] text-slate-500 font-mono">{inv.customerPhone}</p>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={cn(
                      "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
                      inv.paymentMode === 'Cash' 
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : inv.paymentMode === 'Card'
                        ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                        : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                    )}>
                      {inv.paymentMode === 'Cash' && <Wallet size={10} />}
                      {inv.paymentMode === 'Card' && <CreditCard size={10} />}
                      {inv.paymentMode === 'Online' && <Landmark size={10} />}
                      {inv.paymentMode}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center font-bold">
                    {inv.items?.length || 0}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-black text-sm text-emerald-400">
                    {currency} {formatAmount(inv.totalAmount, currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-bold text-xs text-rose-400">
                    {currency} {formatAmount(inv.totalCost || 0, currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-black text-xs text-emerald-300">
                    {currency} {formatAmount(inv.grossProfit || 0, currency)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-bold text-xs text-slate-300">
                    {inv.grossProfitMargin ? `${inv.grossProfitMargin.toFixed(1)}%` : '0%'}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setViewingInvoice(inv)}
                        className="p-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-colors cursor-pointer"
                        title="View / Print Receipt"
                      >
                        <Eye size={15} />
                      </button>

                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDeleteInvoice(inv)}
                          className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors cursor-pointer"
                          title="Admin: Delete Invoice"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-12 text-center text-slate-500 font-bold uppercase tracking-wider text-xs">
                    No sales invoices found for this filter criteria
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Sale Invoice Modal */}
      {isNewSaleModalOpen && (
        <NewSaleInvoiceModal
          business={selectedBusiness}
          branch={selectedBranch}
          branches={branches}
          bankAccounts={bankAccounts}
          catalogProducts={catalogProducts}
          currency={currency}
          onClose={() => setIsNewSaleModalOpen(false)}
          onSuccess={(newInv) => {
            setIsNewSaleModalOpen(false);
            setViewingInvoice(newInv);
          }}
        />
      )}

      {/* View Printable Invoice / Receipt Modal */}
      {viewingInvoice && (
        <SaleReceiptModal
          invoice={viewingInvoice}
          business={selectedBusiness}
          branch={selectedBranch}
          currency={currency}
          onClose={() => setViewingInvoice(null)}
        />
      )}

      {/* SalesPlay Sync Modal */}
      {isSyncModalOpen && (
        <SalesPlaySyncModal
          business={selectedBusiness}
          branches={branches}
          currency={currency}
          onClose={() => setIsSyncModalOpen(false)}
          onProductsSynced={(prods) => setCatalogProducts(prods)}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Quick Sale Invoice Creator Modal
// -------------------------------------------------------------
function NewSaleInvoiceModal({
  business,
  branch,
  branches,
  bankAccounts,
  catalogProducts,
  currency,
  onClose,
  onSuccess,
}: {
  business: Business | null;
  branch: Branch | null;
  branches: Branch[];
  bankAccounts: BankAccount[];
  catalogProducts: SalesPlayProduct[];
  currency: string;
  onClose: () => void;
  onSuccess: (inv: SaleInvoice) => void;
}) {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'Card' | 'Online'>('Cash');
  const [targetBankId, setTargetBankId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Items
  const [items, setItems] = useState<SaleItem[]>([
    {
      id: `item-${Date.now()}-1`,
      name: '',
      quantity: 1,
      unitPrice: 0,
      unitCost: 0,
      totalPrice: 0,
      totalCost: 0,
    }
  ]);

  const targetBranchId = branch?.id || (branches.length > 0 ? branches[0].id : 'global');

  // Filter bank accounts for this branch
  const branchBanks = bankAccounts.filter(b => 
    b.businessId === business?.id && 
    (b.branchId === targetBranchId || b.branchId === 'global' || !b.branchId)
  );

  useEffect(() => {
    if (branchBanks.length > 0 && !targetBankId) {
      setTargetBankId(branchBanks[0].id);
    }
  }, [branchBanks]);

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        name: '',
        quantity: 1,
        unitPrice: 0,
        unitCost: 0,
        totalPrice: 0,
        totalCost: 0,
      }
    ]);
  };

  const handleSelectProduct = (index: number, product: SalesPlayProduct) => {
    const updated = [...items];
    const unitPrice = Number(product.price) || 0;
    const unitCost = Number(product.cost) || 0;
    const qty = Number(updated[index].quantity) || 1;

    updated[index] = {
      ...updated[index],
      productId: product.id,
      productCode: product.product_code,
      name: product.product_name,
      barcode: product.barcode,
      category: product.category,
      unit: product.measurement || 'pcs',
      unitPrice,
      unitCost,
      totalPrice: toStrictDecimal3(qty * unitPrice),
      totalCost: toStrictDecimal3(qty * unitCost),
    };
    setItems(updated);
  };

  const handleUpdateItem = (index: number, field: keyof SaleItem, val: any) => {
    const updated = [...items];
    const curr = { ...updated[index], [field]: val };
    const q = Number(curr.quantity) || 0;
    const p = Number(curr.unitPrice) || 0;
    const c = Number(curr.unitCost) || 0;

    curr.totalPrice = toStrictDecimal3(q * p);
    curr.totalCost = toStrictDecimal3(q * c);
    updated[index] = curr;
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let cost = 0;
    items.forEach(i => {
      subtotal += Number(i.totalPrice) || 0;
      cost += Number(i.totalCost) || 0;
    });
    const grossProfit = subtotal - cost;
    const margin = subtotal > 0 ? (grossProfit / subtotal) * 100 : 0;
    return {
      subtotal: toStrictDecimal3(subtotal),
      cost: toStrictDecimal3(cost),
      grossProfit: toStrictDecimal3(grossProfit),
      margin: margin.toFixed(1),
    };
  }, [items]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    if (items.length === 0 || items.every(i => !i.name.trim())) {
      toast.error('Please add at least one product to the invoice');
      return;
    }

    setSaving(true);
    try {
      const invNum = `INV-${Date.now().toString().slice(-4)}`;
      const selectedBank = branchBanks.find(b => b.id === targetBankId);

      const invoicePayload: SaleInvoice = {
        businessId: business.id,
        ownerId: business.ownerId || auth.currentUser?.uid || '',
        branchId: targetBranchId,
        invoiceNumber: invNum,
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: customerPhone.trim() || undefined,
        items: items.map(i => ({
          ...i,
          name: i.name.trim() || 'Custom Item',
          quantity: toStrictDecimal3(Number(i.quantity) || 1),
          unitPrice: toStrictDecimal3(Number(i.unitPrice) || 0),
          unitCost: toStrictDecimal3(Number(i.unitCost) || 0),
          totalPrice: toStrictDecimal3(Number(i.totalPrice) || 0),
          totalCost: toStrictDecimal3(Number(i.totalCost) || 0),
        })),
        subtotal: totals.subtotal,
        totalAmount: totals.subtotal,
        totalCost: totals.cost,
        grossProfit: totals.grossProfit,
        grossProfitMargin: Number(totals.margin) || 0,
        paymentMode,
        bankId: (paymentMode === 'Card' || paymentMode === 'Online') ? targetBankId : undefined,
        bankName: selectedBank ? `${selectedBank.bankName} - ${selectedBank.accountName}` : undefined,
        source: 'manual_pos',
        date: new Date().toISOString(),
        createdAt: serverTimestamp(),
        notes: notes.trim() || undefined,
      };

      // 1. Save Sale to Firestore
      const docRef = await addDoc(collection(db, 'sales'), invoicePayload);

      // 2. If Card or Online Bank payment, credit the bank account
      if ((paymentMode === 'Card' || paymentMode === 'Online') && targetBankId && totals.subtotal > 0) {
        try {
          await updateDoc(doc(db, 'bankAccounts', targetBankId), {
            balance: increment(totals.subtotal)
          });
        } catch (bErr) {
          console.warn('Bank balance increment notice:', bErr);
        }
      }

      // 3. Record transaction in Finance Manager
      try {
        await addDoc(collection(db, 'transactions'), {
          businessId: business.id,
          ownerId: business.ownerId || auth.currentUser?.uid || '',
          branchId: targetBranchId,
          userId: auth.currentUser?.uid || '',
          type: 'income',
          amount: totals.subtotal,
          toAccount: paymentMode === 'Cash' ? 'cash' : 'bank',
          toBankId: (paymentMode === 'Card' || paymentMode === 'Online') ? targetBankId : undefined,
          category: `POS Sale (${paymentMode})`,
          description: `Sale Invoice #${invNum} • ${customerName || 'Walk-in'}`,
          date: new Date().toISOString(),
          createdAt: serverTimestamp(),
        });
      } catch (tErr) {
        console.warn('Finance transaction log notice:', tErr);
      }

      toast.success(`Sale Invoice #${invNum} created successfully!`);
      onSuccess({ id: docRef.id, ...invoicePayload });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'sales');
      toast.error('Failed to create sale invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 text-emerald-400">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <Receipt size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                New Sale Invoice (POS)
              </h3>
              <p className="text-[10px] text-slate-400">
                Itemized billing with automatic COGS calculation and gross profit
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Customer & Payment Mode */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-950/40 p-4 rounded-2xl border border-slate-800">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Customer Name
              </label>
              <input
                type="text"
                placeholder="Walk-in Customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Customer Phone
              </label>
              <input
                type="text"
                placeholder="Optional Phone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Payment Mode *
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['Cash', 'Card', 'Online'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMode(mode)}
                    className={cn(
                      "py-2 rounded-xl text-xs font-bold transition-all border",
                      paymentMode === mode 
                        ? "bg-emerald-600 border-emerald-500 text-white shadow" 
                        : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {(paymentMode === 'Card' || paymentMode === 'Online') && (
              <div className="sm:col-span-3 space-y-1.5 pt-2 border-t border-slate-800">
                <label className="text-[10px] font-black uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                  <Landmark size={12} />
                  Deposit Payment to Bank Account *
                </label>
                <select
                  value={targetBankId}
                  onChange={(e) => setTargetBankId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white outline-none focus:border-blue-500"
                  required
                >
                  <option value="">-- Select Bank Account --</option>
                  {branchBanks.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} - {b.accountName} ({currency} {formatAmount(b.balance, currency)})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Items Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <ShoppingBag size={15} className="text-emerald-400" />
                Products & Line Items
              </label>
              <button
                type="button"
                onClick={handleAddItem}
                className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-1.5 px-3 rounded-xl transition-all cursor-pointer"
              >
                <Plus size={14} /> Add Row
              </button>
            </div>

            <div className="space-y-2.5">
              {items.map((item, idx) => (
                <div key={item.id} className="p-3 bg-slate-950/40 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center gap-3">
                  <div className="text-xs font-bold text-slate-500 w-5">
                    {idx + 1}.
                  </div>

                  {/* Product autocomplete / name */}
                  <div className="flex-1 w-full space-y-1">
                    <input
                      type="text"
                      placeholder="Product Name or Scan Barcode..."
                      value={item.name}
                      onChange={(e) => handleUpdateItem(idx, 'name', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-white outline-none focus:border-blue-500 font-bold"
                      required
                    />
                    {/* Catalog quick match pill */}
                    {catalogProducts.length > 0 && !item.productId && (
                      <div className="flex flex-wrap gap-1 mt-1 max-h-16 overflow-y-auto">
                        {catalogProducts
                          .filter(p => !item.name || p.product_name.toLowerCase().includes(item.name.toLowerCase()))
                          .slice(0, 4)
                          .map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleSelectProduct(idx, p)}
                              className="text-[9px] bg-slate-800 hover:bg-emerald-600/30 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700 truncate max-w-[140px]"
                            >
                              + {p.product_name} ({currency} {formatAmount(p.price || 0, currency)})
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Quantity */}
                  <div className="w-20">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Qty</label>
                    <input
                      type="number"
                      step="any"
                      min="0.001"
                      value={item.quantity}
                      onChange={(e) => handleUpdateItem(idx, 'quantity', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-white outline-none focus:border-blue-500 font-mono font-bold"
                      required
                    />
                  </div>

                  {/* Selling Price */}
                  <div className="w-28">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Selling Price ({currency})</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={item.unitPrice}
                      onChange={(e) => handleUpdateItem(idx, 'unitPrice', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-emerald-400 outline-none focus:border-blue-500 font-mono font-bold"
                      required
                    />
                  </div>

                  {/* Unit Cost (COGS) */}
                  <div className="w-28">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Cost/COGS ({currency})</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={item.unitCost}
                      onChange={(e) => handleUpdateItem(idx, 'unitCost', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-rose-400 outline-none focus:border-blue-500 font-mono font-bold"
                      placeholder="0.000"
                    />
                  </div>

                  {/* Row Total */}
                  <div className="w-24 text-right">
                    <label className="text-[9px] text-slate-500 block uppercase font-bold">Total</label>
                    <p className="text-xs font-mono font-black text-white mt-1">
                      {currency} {formatAmount(item.totalPrice, currency)}
                    </p>
                  </div>

                  {/* Remove */}
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(idx)}
                      className="p-2 text-slate-500 hover:text-rose-400 rounded-xl hover:bg-slate-800 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Grand Totals Summary Box */}
          <div className="p-4 bg-slate-950/70 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Gross Profit Preview</p>
              <p className="text-sm font-black text-emerald-400 font-mono">
                +{currency} {formatAmount(totals.grossProfit, currency)} ({totals.margin}%)
              </p>
            </div>

            <div className="text-right">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Sale Invoice</span>
              <span className="text-2xl font-black font-mono text-emerald-400">
                {currency} {formatAmount(totals.subtotal, currency)}
              </span>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black py-2.5 px-6 rounded-xl shadow-lg shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
            >
              {saving ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              ) : (
                <CheckCircle2 size={16} />
              )}
              <span>Complete Sale & Print</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Printable POS Invoice / Receipt Modal (Unified Single Header Bar)
// -------------------------------------------------------------
function SaleReceiptModal({
  invoice,
  business,
  branch,
  currency,
  onClose,
}: {
  invoice: SaleInvoice;
  business: Business | null;
  branch: Branch | null;
  currency: string;
  onClose: () => void;
}) {
  const handleDownloadPdf = () => {
    downloadElementAsPdf('printable-receipt', `Receipt_${invoice.invoiceNumber}.pdf`, false);
  };

  const createdDate = invoice.date 
    ? format(parseISO(invoice.date), 'dd MMM yyyy, HH:mm') 
    : format(new Date(), 'dd MMM yyyy, HH:mm');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Unified Top Action Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 text-emerald-400">
            <div className="p-2 bg-emerald-500/10 rounded-xl">
              <Receipt size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Sale Receipt <span className="font-mono text-emerald-400">#{invoice.invoiceNumber}</span>
              </h3>
              <p className="text-[10px] text-slate-400">Payment: {invoice.paymentMode}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-900/30 transition-all cursor-pointer active:scale-95"
            >
              <Download size={15} />
              <span>Download PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <X size={15} />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Scrollable Printable Paper */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-950/40 flex justify-center">
          <div id="printable-receipt" className="w-full max-w-lg p-6 sm:p-8 bg-white text-slate-900 space-y-5 rounded-2xl shadow-xl border border-slate-200 font-sans">
            {/* Store Header */}
            <div className="text-center border-b-2 border-slate-900 pb-4">
              <h1 className="text-xl font-black uppercase tracking-tight text-slate-950">
                {business?.name || 'SHOMEDESK STORE'}
              </h1>
              <p className="text-xs font-semibold text-slate-600 mt-0.5">
                {branch?.name || 'Main Branch'} • {branch?.location || 'Central Location'}
              </p>
              {business?.mobileNumber && (
                <p className="text-xs text-slate-500">Tel: {business.mobileNumber}</p>
              )}
              <div className="mt-2 inline-block bg-slate-100 text-slate-800 text-[10px] font-black uppercase tracking-widest px-3 py-0.5 rounded-full border border-slate-300">
                Official POS Tax Receipt
              </div>
            </div>

            {/* Receipt Meta */}
            <div className="grid grid-cols-2 text-xs border-b border-slate-200 pb-3">
              <div>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Invoice Number</p>
                <p className="font-mono font-bold text-slate-900">#{invoice.invoiceNumber}</p>
                <p className="text-slate-500 text-[10px] uppercase font-bold mt-1.5">Date & Time</p>
                <p className="text-slate-700 text-[11px]">{createdDate}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-500 text-[10px] uppercase font-bold">Customer</p>
                <p className="font-bold text-slate-900">{invoice.customerName || 'Walk-in Customer'}</p>
                <p className="text-slate-500 text-[10px] uppercase font-bold mt-1.5">Payment Method</p>
                <p className="font-black text-emerald-700">{invoice.paymentMode}</p>
              </div>
            </div>

            {/* Items Table */}
            <div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-300 text-slate-600 text-[10px] font-black uppercase tracking-wider">
                    <th className="py-2">Item</th>
                    <th className="py-2 text-center">Qty</th>
                    <th className="py-2 text-right">Rate</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {invoice.items?.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5">
                        <p className="font-bold text-slate-900">{item.name}</p>
                        {item.barcode && (
                          <span className="font-mono text-[9px] text-slate-400">Barcode: {item.barcode}</span>
                        )}
                      </td>
                      <td className="py-2.5 text-center font-bold">{item.quantity}</td>
                      <td className="py-2.5 text-right font-mono">{formatAmount(item.unitPrice, currency)}</td>
                      <td className="py-2.5 text-right font-mono font-bold">{formatAmount(item.totalPrice, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Totals */}
            <div className="border-t-2 border-slate-900 pt-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="font-mono font-bold">{currency} {formatAmount(invoice.subtotal || invoice.totalAmount, currency)}</span>
              </div>
              <div className="flex justify-between text-base font-black text-slate-950 pt-2 border-t border-slate-200">
                <span>Total Amount Paid</span>
                <span className="font-mono text-emerald-700">{currency} {formatAmount(invoice.totalAmount, currency)}</span>
              </div>
            </div>

            {/* Barcode & Thank You */}
            <div className="pt-4 border-t border-dashed border-slate-300 text-center space-y-2">
              <div className="flex justify-center">
                <Barcode value={invoice.invoiceNumber} height={30} width={1.2} fontSize={9} />
              </div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                Thank you for your business! Please visit again.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
