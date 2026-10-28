import React, { useState, useEffect, useMemo } from 'react';
import {
  SalesPlayShop,
  SalesPlayProduct,
  SalesPlayCategory,
  Branch,
  SalesPlaySettings,
  Business
} from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import {
  fetchSalesPlayShops,
  fetchSalesPlayProductsWithInventory,
  fetchSalesPlayCategories,
  syncAllSalesPlayCatalogToFirestore,
  getSalesPlaySettings,
  saveSalesPlaySettings,
  syncSalesPlaySalesToFirestore,
  DEFAULT_SALESPLAY_CONFIG
} from '@/src/services/salesplay';
import { 
  X, 
  RefreshCw, 
  CheckCircle2, 
  Store, 
  Package, 
  Barcode as BarcodeIcon, 
  ShieldCheck, 
  HelpCircle, 
  Landmark, 
  Receipt, 
  Calendar, 
  TrendingUp, 
  Wallet, 
  CreditCard 
} from 'lucide-react';
import { Barcode } from './Barcode';
import { toast } from 'sonner';
import { startOfDay, endOfDay, subDays } from 'date-fns';
import { formatAmount } from '@/src/lib/currencyUtils';
import { auth } from '@/src/lib/firebase';

interface SalesPlaySyncModalProps {
  business: Business | null;
  branches: Branch[];
  currency: string;
  onClose: () => void;
  onProductsSynced?: (products: SalesPlayProduct[]) => void;
}

export function SalesPlaySyncModal({
  business,
  branches,
  currency,
  onClose,
  onProductsSynced,
}: SalesPlaySyncModalProps) {
  const { bankAccounts } = useBusiness();
  const [loading, setLoading] = useState(false);
  const [shops, setShops] = useState<SalesPlayShop[]>([]);
  const [products, setProducts] = useState<SalesPlayProduct[]>([]);
  const [settings, setSettings] = useState<SalesPlaySettings | null>(null);
  const [branchMap, setBranchMap] = useState<{ [branchId: string]: string }>({});
  const [activeShopId, setActiveShopId] = useState(DEFAULT_SALESPLAY_CONFIG.defaultShopId);
  const [cardBankId, setCardBankId] = useState('');
  const [onlineBankId, setOnlineBankId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [categories, setCategories] = useState<SalesPlayCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [syncingReceipts, setSyncingReceipts] = useState(false);
  const [receiptSyncRange, setReceiptSyncRange] = useState<'today' | '7days' | '30days'>('30days');
  const [lastSyncResult, setLastSyncResult] = useState<{
    importedCount: number;
    totalSales: number;
    totalCogs: number;
    grossProfit: number;
    cashTotal: number;
    cardTotal: number;
    onlineTotal: number;
  } | null>(null);

  const handleSyncSalesReceipts = async () => {
    if (!business) return;
    setSyncingReceipts(true);
    const toastId = toast.loading('Syncing Sales Receipts from SalesPlay POS...');
    try {
      const today = new Date();
      let startDate: Date;
      if (receiptSyncRange === 'today') {
        startDate = startOfDay(today);
      } else if (receiptSyncRange === '7days') {
        startDate = subDays(today, 7);
      } else {
        startDate = subDays(today, 29);
      }

      const res = await syncSalesPlaySalesToFirestore({
        businessId: business.id,
        ownerId: business.ownerId || auth.currentUser?.uid || '',
        branchId: branches[0]?.id || 'main',
        shopId: activeShopId,
        startDate,
        endDate: endOfDay(today),
      });

      if (res.success) {
        setLastSyncResult({
          importedCount: res.importedCount,
          totalSales: res.totalSales,
          totalCogs: res.totalCogs,
          grossProfit: res.grossProfit,
          cashTotal: res.cashTotal,
          cardTotal: res.cardTotal,
          onlineTotal: res.onlineTotal,
        });
        toast.success(
          `Synced ${res.importedCount} receipts! Total: ${currency} ${formatAmount(res.totalSales, currency)} (COGS: ${currency} ${formatAmount(res.totalCogs, currency)} | Gross Profit: ${currency} ${formatAmount(res.grossProfit, currency)})`,
          { id: toastId, duration: 6000 }
        );
      } else {
        toast.info(res.message, { id: toastId });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to sync sales receipts', { id: toastId });
    } finally {
      setSyncingReceipts(false);
    }
  };

  useEffect(() => {
    async function init() {
      if (!business) return;
      setLoading(true);
      try {
        const savedSettings = await getSalesPlaySettings(business.id);
        setSettings(savedSettings);
        setBranchMap(savedSettings.branchShopMap || {});
        setActiveShopId(savedSettings.selectedShopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId);
        setCardBankId(savedSettings.defaultCardBankId || '');
        setOnlineBankId(savedSettings.defaultOnlineBankId || '');

        // Fetch Shops
        const shopList = await fetchSalesPlayShops(savedSettings.apiToken);
        setShops(shopList);

        // Fetch Categories and Products with inventory (force fresh fetch)
        const [catList, prodList] = await Promise.all([
          fetchSalesPlayCategories(savedSettings.apiToken, true),
          fetchSalesPlayProductsWithInventory(
            savedSettings.apiToken,
            savedSettings.selectedShopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId,
            true
          ),
        ]);
        setCategories(catList);
        setProducts(prodList);
        if (onProductsSynced) {
          onProductsSynced(prodList);
        }
      } catch (err) {
        console.error('Failed to init SalesPlay modal:', err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [business]);

  const handleSyncNow = async () => {
    if (!settings) return;
    setLoading(true);
    try {
      const [catList, prodList] = await Promise.all([
        fetchSalesPlayCategories(settings.apiToken, true),
        fetchSalesPlayProductsWithInventory(settings.apiToken, activeShopId, true),
      ]);
      setCategories(catList);
      setProducts(prodList);
      if (business) {
        await syncAllSalesPlayCatalogToFirestore(business.id);
      }
      if (onProductsSynced) {
        onProductsSynced(prodList);
      }
      toast.success(`Successfully synchronized all ${prodList.length} items across ${catList.length} categories from SalesPlay!`);
    } catch (err) {
      toast.error('Sync failed. Please check network.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBranchMapping = async () => {
    if (!business || !settings) return;
    try {
      const updated: SalesPlaySettings = {
        ...settings,
        selectedShopId: activeShopId,
        branchShopMap: branchMap,
        defaultCardBankId: cardBankId,
        defaultOnlineBankId: onlineBankId,
      };
      await saveSalesPlaySettings(updated);
      setSettings(updated);
      toast.success('SalesPlay settings and payment bank routing saved!');
    } catch (err) {
      toast.error('Failed to save settings');
    }
  };

  const allCategoryList = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach(p => {
      const cat = p.category || 'General';
      map.set(cat, (map.get(cat) || 0) + 1);
    });

    categories.forEach(c => {
      if (!map.has(c.category_name)) {
        map.set(c.category_name, 0);
      }
    });

    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [products, categories]);

  const filteredProducts = products.filter(p => {
    const matchesCategory = selectedCategory === 'all' || (p.category || '').toLowerCase() === selectedCategory.toLowerCase();
    if (!matchesCategory) return false;

    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.product_name.toLowerCase().includes(term) ||
      p.product_code.toLowerCase().includes(term) ||
      (p.barcode && p.barcode.toLowerCase().includes(term)) ||
      (p.category && p.category.toLowerCase().includes(term))
    );
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3 text-emerald-400">
            <Store size={24} />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black uppercase tracking-wider text-slate-100">
                  SalesPlay POS Integration & Shop Mapping
                </h2>
                <span className="bg-emerald-950 text-emerald-400 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border border-emerald-800 flex items-center gap-1">
                  <CheckCircle2 size={11} /> Connected
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Account: <span className="font-bold text-slate-200">makarembakkala@gmail.com</span> • Live Stock Sync & Barcodes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Shop Detection & Explanation Card */}
          <div className="p-5 bg-blue-950/20 border border-blue-800/40 rounded-2xl space-y-3">
            <div className="flex items-start gap-3">
              <HelpCircle size={20} className="text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-300 space-y-1">
                <p className="font-bold text-slate-100 text-sm">
                  How does ShomeDesk know which SalesPlay shop to update?
                </p>
                <p className="text-slate-400 leading-relaxed">
                  Your SalesPlay account has shop: <span className="text-blue-300 font-bold">"MAKAREM ALKHAIR MODERN"</span>.
                  Below you can map each of your ShomeDesk Branches to a SalesPlay Shop. Whenever you log a Purchase Bill in Bill Entry,
                  the system automatically increments stock in that exact SalesPlay Shop in real-time!
                </p>
              </div>
            </div>

            {/* Branch to Shop Mapping Section */}
            <div className="pt-2 border-t border-blue-900/40 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                  Default SalesPlay Shop
                </label>
                <select
                  value={activeShopId}
                  onChange={(e) => setActiveShopId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-blue-500 font-bold"
                >
                  {shops.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.shop_name} ({s.id.slice(0, 8)}...)
                    </option>
                  ))}
                  {shops.length === 0 && (
                    <option value={DEFAULT_SALESPLAY_CONFIG.defaultShopId}>
                      {DEFAULT_SALESPLAY_CONFIG.defaultShopName}
                    </option>
                  )}
                </select>
              </div>

              {branches.length > 0 && (
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1">
                    Map ShomeDesk Branches to SalesPlay Shops
                  </label>
                  <div className="space-y-2">
                    {branches.map(br => (
                      <div key={br.id} className="flex items-center justify-between text-xs bg-slate-900/80 p-2 rounded-xl border border-slate-800">
                        <span className="font-bold text-slate-300">{br.name}:</span>
                        <select
                          value={branchMap[br.id] || activeShopId}
                          onChange={(e) => setBranchMap({ ...branchMap, [br.id]: e.target.value })}
                          className="bg-slate-950 border border-slate-700 rounded-lg p-1 text-[11px] text-slate-200 outline-none"
                        >
                          {shops.map(s => (
                            <option key={s.id} value={s.id}>{s.shop_name}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Bank Direction & Auto-Routing Section */}
            <div className="pt-3 border-t border-blue-900/40 space-y-3">
              <div className="flex items-center gap-2 text-indigo-400">
                <Landmark size={15} />
                <h4 className="text-xs font-black uppercase tracking-wider">
                  Payment Auto-Direction & Bank Settings
                </h4>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                When SalesPlay POS sales or billings are processed, cash goes to drawer automatically. For Card and Online payments, choose which default bank account they route to. You can change this anytime.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-300 block mb-1">
                    Card Payments Default Bank:
                  </label>
                  <select
                    value={cardBankId}
                    onChange={(e) => setCardBankId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Choose Default Bank for Card Sales --</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} - {b.accountName} ({b.accountNumber})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-300 block mb-1">
                    Online / Transfer Default Bank:
                  </label>
                  <select
                    value={onlineBankId}
                    onChange={(e) => setOnlineBankId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Choose Default Bank for Online Bills --</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} - {b.accountName} ({b.accountNumber})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveBranchMapping}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2.5 px-5 rounded-xl cursor-pointer shadow-lg transition-all active:scale-95"
              >
                Save Shop & Bank Settings
              </button>
            </div>
          </div>

          {/* Sales Receipts & Invoices Sync Panel */}
          <div className="p-5 bg-gradient-to-br from-emerald-950/30 to-slate-900 border border-emerald-500/30 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-emerald-400">
                <Receipt size={20} />
                <div>
                  <h4 className="text-sm font-black uppercase tracking-wider text-slate-100 flex items-center gap-2">
                    Live POS Sales Receipts Sync
                    <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                      Automatic Invoicing & P&L
                    </span>
                  </h4>
                  <p className="text-xs text-slate-400">
                    Import historical and real-time sales receipts from your SalesPlay POS terminal into ShomeDesk.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setReceiptSyncRange('today')}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      receiptSyncRange === 'today' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptSyncRange('7days')}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      receiptSyncRange === '7days' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    7 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptSyncRange('30days')}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                      receiptSyncRange === '30days' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    30 Days
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSyncSalesReceipts}
                  disabled={syncingReceipts}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-900/40 cursor-pointer transition-all active:scale-95"
                >
                  <RefreshCw size={14} className={syncingReceipts ? 'animate-spin' : ''} />
                  <span>{syncingReceipts ? 'Syncing Receipts...' : '⚡ Sync Sales Receipts'}</span>
                </button>
              </div>
            </div>

            {lastSyncResult && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-black block">Receipts Imported</span>
                  <span className="text-emerald-400 font-mono font-bold text-sm">{lastSyncResult.importedCount} Invoices</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-black block">Total Sales</span>
                  <span className="text-white font-mono font-bold text-sm">{currency} {formatAmount(lastSyncResult.totalSales, currency)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-black block">Cost of Goods (COGS)</span>
                  <span className="text-rose-400 font-mono font-bold text-sm">{currency} {formatAmount(lastSyncResult.totalCogs, currency)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-black block">Gross Profit</span>
                  <span className="text-emerald-300 font-mono font-bold text-sm">+{currency} {formatAmount(lastSyncResult.grossProfit, currency)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Synchronized Products Section */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Package size={18} className="text-emerald-400" />
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-200">
                  Synchronized SalesPlay Products ({products.length})
                </h3>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Search products or barcode..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none w-48 sm:w-64 focus:border-emerald-500"
                />

                <button
                  onClick={handleSyncNow}
                  disabled={loading}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold py-2 px-4 rounded-xl shadow cursor-pointer transition-all shrink-0"
                >
                  <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                  {loading ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            </div>

            {/* Category Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                All Items ({products.length})
              </button>
              {allCategoryList.map(([catName, count]) => (
                <button
                  key={catName}
                  type="button"
                  onClick={() => setSelectedCategory(catName)}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedCategory.toLowerCase() === catName.toLowerCase()
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span>{catName}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    selectedCategory.toLowerCase() === catName.toLowerCase()
                      ? 'bg-emerald-800 text-emerald-100'
                      : 'bg-slate-900 text-slate-400'
                  }`}>
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* Products Table */}
            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/40">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950 text-slate-400 font-black uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-3">Item / Image</th>
                    <th className="py-3 px-3">Product Name</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3 text-center">Barcode</th>
                    <th className="py-3 px-3 text-right">In Stock (SalesPlay)</th>
                    <th className="py-3 px-3 text-right">Cost Price</th>
                    <th className="py-3 px-3 text-right">Selling Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {filteredProducts.map(p => (
                    <tr key={p.id} className="hover:bg-slate-900/50">
                      <td className="py-3 px-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 overflow-hidden">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.product_name} className="w-full h-full object-cover" />
                          ) : (
                            <Package size={16} />
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-bold text-slate-100">{p.product_name}</p>
                        <p className="text-[10px] font-mono text-slate-400">Code: {p.product_code}</p>
                      </td>
                      <td className="py-3 px-3 text-slate-400">{p.category}</td>
                      <td className="py-3 px-3 text-center">
                        {p.barcode ? (
                          <Barcode value={p.barcode} height={24} width={1.0} fontSize={8} />
                        ) : (
                          <span className="text-slate-500 italic text-[10px]">No Barcode</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="bg-emerald-950 text-emerald-400 font-black text-xs px-2.5 py-1 rounded-lg border border-emerald-800">
                          {p.in_stock ?? 0} {p.measurement || 'units'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-slate-300">
                        {currency}{p.cost || 0}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-emerald-400">
                        {currency}{p.price || 0}
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500 font-bold uppercase tracking-widest text-xs">
                        {loading ? 'Fetching products from SalesPlay...' : 'No products found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
