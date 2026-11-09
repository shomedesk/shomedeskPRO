import React, { useState, useEffect, useMemo } from 'react';
import { SalesPlayProduct, Business, Branch } from '@/src/types';
import { formatAmount } from '@/src/lib/currencyUtils';
import { generateProductReportPdf, exportProductReportExcel } from '@/src/lib/pdfUtils';
import { fetchSalesPlayProductsWithInventory, DEFAULT_SALESPLAY_CONFIG, getSalesPlaySettings } from '@/src/services/salesplay';
import { 
  X, 
  Download, 
  FileSpreadsheet, 
  RefreshCw, 
  Search, 
  Filter, 
  Package, 
  Layers, 
  CheckCircle2, 
  AlertTriangle,
  ArrowUpDown,
  FileText,
  BarChart3
} from 'lucide-react';
import { toast } from 'sonner';

interface ProductReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currency?: string;
  selectedBusiness?: Business | null;
  selectedBranch?: Branch | null;
  initialProducts?: SalesPlayProduct[];
}

export function ProductReportModal({
  isOpen,
  onClose,
  currency = 'OMR',
  selectedBusiness,
  selectedBranch,
  initialProducts,
}: ProductReportModalProps) {
  const [products, setProducts] = useState<SalesPlayProduct[]>(initialProducts || []);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [showKpis, setShowKpis] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1200; // Open on large desktop; collapsed on tablets & phones to maximize table space
    }
    return false;
  });

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [sortBy, setSortBy] = useState<'serial' | 'name' | 'stock_desc' | 'cost_desc' | 'price_desc'>('serial');

  const loadLiveProducts = async (force: boolean = false) => {
    if (force) setRefreshing(true);
    else if (products.length === 0) setLoading(true);

    try {
      const activeBus = selectedBusiness || null;
      const spSettings = activeBus ? await getSalesPlaySettings(activeBus.id) : null;
      const token = spSettings?.apiToken || DEFAULT_SALESPLAY_CONFIG.apiToken;
      const shopId = selectedBranch?.id 
        ? (spSettings?.branchShopMap?.[selectedBranch.id] || spSettings?.selectedShopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId)
        : (spSettings?.selectedShopId || DEFAULT_SALESPLAY_CONFIG.defaultShopId);

      const loaded = await fetchSalesPlayProductsWithInventory(token, shopId, force);
      if (loaded && loaded.length > 0) {
        setProducts(loaded);
        if (force) {
          toast.success(`Refreshed! Imported all ${loaded.length} products from SalesPlay POS.`);
        }
      } else {
        toast.info('No products retrieved from SalesPlay.');
      }
    } catch (err: any) {
      console.warn('Failed to load SalesPlay products:', err);
      toast.error('Network notice fetching live products');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (products.length === 0) {
        loadLiveProducts(false);
      }
    }
  }, [isOpen]);

  // Categories list with counts
  const categoriesWithCounts = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach(p => {
      const cat = (p.category || 'General').trim();
      map.set(cat, (map.get(cat) || 0) + 1);
    });

    const list = Array.from(map.entries()).map(([name, count]) => ({ name, count }));
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [products]);

  // Filtered and sorted products
  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      // Search filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchName = (p.product_name || '').toLowerCase().includes(query);
        const matchBarcode = (p.barcode || '').toLowerCase().includes(query);
        const matchCode = (p.product_code || '').toLowerCase().includes(query);
        const matchCat = (p.category || '').toLowerCase().includes(query);
        if (!matchName && !matchBarcode && !matchCode && !matchCat) {
          return false;
        }
      }

      // Category filter
      if (selectedCategory !== 'all') {
        const pCat = (p.category || 'General').trim().toLowerCase();
        if (pCat !== selectedCategory.toLowerCase()) {
          return false;
        }
      }

      // Stock status filter
      const stock = Number(p.in_stock) || 0;
      if (stockFilter === 'in_stock' && stock <= 0) return false;
      if (stockFilter === 'out_of_stock' && stock > 0) return false;

      return true;
    });

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'name') {
        return (a.product_name || '').localeCompare(b.product_name || '');
      }
      if (sortBy === 'stock_desc') {
        return (Number(b.in_stock) || 0) - (Number(a.in_stock) || 0);
      }
      if (sortBy === 'cost_desc') {
        return (Number(b.cost) || 0) - (Number(a.cost) || 0);
      }
      if (sortBy === 'price_desc') {
        return (Number(b.price) || 0) - (Number(a.price) || 0);
      }
      // 'serial' default keeps catalog order
      return 0;
    });

    return result;
  }, [products, searchTerm, selectedCategory, stockFilter, sortBy]);

  // Financial summary metrics
  const summary = useMemo(() => {
    let totalItems = products.length;
    let filteredCount = filteredProducts.length;
    let totalStockQty = 0;
    let totalCostVal = 0;
    let totalRetailVal = 0;
    let inStockItems = 0;
    let zeroCostCount = 0;

    filteredProducts.forEach(p => {
      const q = Number(p.in_stock) || 0;
      const c = Number(p.cost) || 0;
      const s = Number(p.price) || 0;

      totalStockQty += q;
      totalCostVal += q * c;
      totalRetailVal += q * s;
      if (q > 0) inStockItems++;
      if (c <= 0) zeroCostCount++;
    });

    const potentialMargin = totalRetailVal - totalCostVal;
    const marginPercent = totalRetailVal > 0 ? (potentialMargin / totalRetailVal) * 100 : 0;

    return {
      totalItems,
      filteredCount,
      totalStockQty: Math.round(totalStockQty * 1000) / 1000,
      totalCostVal,
      totalRetailVal,
      potentialMargin,
      marginPercent: Math.round(marginPercent * 10) / 10,
      inStockItems,
      outOfStockItems: filteredCount - inStockItems,
      zeroCostCount,
    };
  }, [products, filteredProducts]);

  const [includeImagesInPdf, setIncludeImagesInPdf] = useState<boolean>(true);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // Handle PDF Download (Multi-page with Scannable Barcodes & Photos)
  const handleDownloadPdf = async () => {
    if (filteredProducts.length === 0) {
      toast.error('No products match the filter to export.');
      return;
    }

    setIsGeneratingPdf(true);
    try {
      await generateProductReportPdf({
        products: filteredProducts,
        business: selectedBusiness,
        branch: selectedBranch,
        currency,
        filterInfo: {
          category: selectedCategory,
          search: searchTerm,
          stockFilter: stockFilter,
        },
        includeImages: includeImagesInPdf,
      });
    } catch (err: any) {
      console.warn('PDF export notice:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Handle Excel Download
  const handleDownloadExcel = () => {
    if (filteredProducts.length === 0) {
      toast.error('No products match the filter to export.');
      return;
    }

    exportProductReportExcel({
      products: filteredProducts,
      businessName: selectedBusiness?.name || 'MAKAREM ALKHAIR MODERN',
      currency,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-2 md:p-3 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#0F172A] border border-slate-700 w-full max-w-7xl h-[100dvh] sm:h-[96dvh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden relative">
        
        {/* SLIM STICKY TOP BAR (Height only ~44px, never consumes screen space) */}
        <div className="h-11 px-3 sm:px-4 bg-[#1E293B] border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 z-30">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 shrink-0">
              <Package size={15} />
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <h2 className="text-xs sm:text-sm font-extrabold text-white truncate">
                Product Report
              </h2>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.2 rounded-full border border-emerald-500/30 font-bold shrink-0">
                {products.length} Items
              </span>
            </div>
          </div>

          {/* Top Quick Actions */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              onClick={() => setShowKpis(!showKpis)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                showKpis 
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40' 
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Toggle financial metric summary cards"
            >
              <BarChart3 size={12} className={showKpis ? 'text-blue-400' : 'text-slate-400'} />
              <span>{showKpis ? 'Hide Stats' : 'Stats'}</span>
            </button>

            <button
              onClick={() => loadLiveProducts(true)}
              disabled={refreshing || loading}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
              title="Sync latest live items and stock from SalesPlay"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin text-blue-400' : 'text-slate-400'} />
              <span className="hidden sm:inline">{refreshing ? 'Syncing...' : 'Sync'}</span>
            </button>

            <label className="flex items-center gap-1 text-[11px] text-slate-300 bg-slate-800/80 hover:bg-slate-800 px-2 py-1 rounded-lg border border-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeImagesInPdf}
                onChange={(e) => setIncludeImagesInPdf(e.target.checked)}
                className="w-3 h-3 rounded text-blue-600 bg-slate-900 border-slate-600 focus:ring-0 cursor-pointer"
              />
              <span className="hidden sm:inline">Photos</span>
            </label>

            <button
              onClick={handleDownloadExcel}
              disabled={filteredProducts.length === 0}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title="Download Excel Spreadsheet"
            >
              <FileSpreadsheet size={12} />
              <span>Excel</span>
            </button>

            <button
              onClick={handleDownloadPdf}
              disabled={filteredProducts.length === 0 || isGeneratingPdf}
              className="flex items-center gap-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-2.5 sm:px-3 py-1 rounded-lg text-[11px] font-bold transition-all shadow-md shadow-blue-900/40 cursor-pointer disabled:opacity-50"
              title="Download Scannable Barcode Multi-Page PDF"
            >
              {isGeneratingPdf ? (
                <RefreshCw size={12} className="animate-spin text-white" />
              ) : (
                <Download size={12} />
              )}
              <span>{isGeneratingPdf ? 'Generating...' : 'PDF'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-all cursor-pointer ml-0.5"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* UNIFIED SCROLLABLE AREA: Everything scrolls naturally, so products get 100% of tablet screen! */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900 overscroll-contain">
          
          {/* Financial KPI Summary Cards - Scrolls up and out of the way! */}
          {showKpis && (
            <div className="p-2 sm:p-2.5 px-3 sm:px-5 bg-slate-900/90 border-b border-slate-800 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 transition-all">
              <div className="bg-[#1E293B] p-2 rounded-xl border border-slate-800">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Products</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-base sm:text-lg font-black text-white">{summary.filteredCount}</span>
                  <span className="text-[10px] text-slate-500">of {summary.totalItems}</span>
                </div>
                <div className="text-[10px] text-emerald-400 font-semibold truncate">
                  {summary.inStockItems} in stock • {summary.outOfStockItems} zero
                </div>
              </div>

              <div className="bg-[#1E293B] p-2 rounded-xl border border-slate-800">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">In-Stock</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-base sm:text-lg font-black text-emerald-400 font-mono">{summary.totalStockQty}</span>
                  <span className="text-[10px] text-slate-500">pcs</span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">On shelf</div>
              </div>

              <div className="bg-[#1E293B] p-2 rounded-xl border border-slate-800">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Cost Value</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-[10px] font-bold text-slate-400">{currency}</span>
                  <span className="text-base sm:text-lg font-black text-blue-400 font-mono truncate">
                    {formatAmount(summary.totalCostVal, currency)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">Invested</div>
              </div>

              <div className="bg-[#1E293B] p-2 rounded-xl border border-slate-800">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Retail Value</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-[10px] font-bold text-slate-400">{currency}</span>
                  <span className="text-base sm:text-lg font-black text-sky-400 font-mono truncate">
                    {formatAmount(summary.totalRetailVal, currency)}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 truncate">Revenue</div>
              </div>

              <div className="bg-[#1E293B] p-2 rounded-xl border border-slate-800 col-span-2 sm:col-span-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Gross Margin</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-[10px] font-bold text-slate-400">{currency}</span>
                  <span className="text-base sm:text-lg font-black text-amber-400 font-mono truncate">
                    {formatAmount(summary.potentialMargin, currency)}
                  </span>
                </div>
                <div className="text-[10px] text-emerald-400 font-semibold truncate">
                  ~{summary.marginPercent}% margin
                </div>
              </div>
            </div>
          )}

          {/* Filter and Search Bar - Scrolls up and out of the way! */}
          <div className="p-2 sm:p-2.5 px-3 sm:px-5 bg-[#162032] border-b border-slate-800 space-y-2">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              
              {/* Search Input */}
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search product name, barcode, code..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Controls: Stock Filter & Sort */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-700/80 text-[10px] sm:text-[11px] font-bold">
                  <button
                    onClick={() => setStockFilter('all')}
                    className={`px-2 py-0.5 rounded-md transition-all ${
                      stockFilter === 'all' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All ({products.length})
                  </button>
                  <button
                    onClick={() => setStockFilter('in_stock')}
                    className={`px-2 py-0.5 rounded-md transition-all ${
                      stockFilter === 'in_stock' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    In Stock
                  </button>
                  <button
                    onClick={() => setStockFilter('out_of_stock')}
                    className={`px-2 py-0.5 rounded-md transition-all ${
                      stockFilter === 'out_of_stock' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Zero Stock
                  </button>
                </div>

                <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-0.5 text-xs text-slate-300">
                  <ArrowUpDown size={12} className="text-slate-400" />
                  <select
                    value={sortBy}
                    onChange={(e: any) => setSortBy(e.target.value)}
                    className="bg-transparent text-[11px] text-slate-200 font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="serial" className="bg-slate-900">Sort: Serial (#)</option>
                    <option value="name" className="bg-slate-900">Sort: Name (A-Z)</option>
                    <option value="stock_desc" className="bg-slate-900">Sort: Stock (High-Low)</option>
                    <option value="cost_desc" className="bg-slate-900">Sort: Cost (High-Low)</option>
                    <option value="price_desc" className="bg-slate-900">Sort: Price (High-Low)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-thin">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold whitespace-nowrap transition-all border ${
                  selectedCategory === 'all'
                    ? 'bg-blue-600/30 text-blue-300 border-blue-500 shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                All Categories ({products.length})
              </button>
              {categoriesWithCounts.map(cat => (
                <button
                  key={cat.name}
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold whitespace-nowrap transition-all border ${
                    selectedCategory.toLowerCase() === cat.name.toLowerCase()
                      ? 'bg-blue-600/30 text-blue-300 border-blue-500 shadow-sm'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {cat.name} <span className="text-[9px] opacity-75 font-mono">({cat.count})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Table Container with Sticky Table Header */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-3">
              <RefreshCw size={36} className="animate-spin text-blue-500" />
              <p className="text-sm font-bold text-slate-300">Importing complete product catalog from SalesPlay POS...</p>
              <p className="text-xs text-slate-500">Checking all categories and live stock quantities...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <Package size={40} className="text-slate-600 mb-2" />
              <h3 className="text-base font-bold text-slate-300">No matching products found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Try adjusting your search terms or select another category filter.
              </p>
              {(searchTerm || selectedCategory !== 'all' || stockFilter !== 'all') && (
                <button
                  onClick={() => { setSearchTerm(''); setSelectedCategory('all'); setStockFilter('all'); }}
                  className="mt-3 text-xs text-blue-400 hover:underline font-bold"
                >
                  Reset all filters
                </button>
              )}
            </div>
          ) : (
            <table className="min-w-[960px] w-full text-left border-collapse">
              <thead className="bg-[#1E293B] text-[11px] font-black uppercase text-slate-400 sticky top-0 z-20 border-b border-slate-700 shadow-md">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">#</th>
                  <th className="py-3 px-2 w-14 text-center">Photo</th>
                  <th className="py-3 px-4">Product Name</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3 text-center">Barcode / Code</th>
                  <th className="py-3 px-3 text-right">Cost Price ({currency})</th>
                  <th className="py-3 px-3 text-right">Sale Price ({currency})</th>
                  <th className="py-3 px-3 text-center">In Stock</th>
                  <th className="py-3 px-3 text-right">Total Cost Value</th>
                  <th className="py-3 px-3 text-right">Total Retail Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs text-slate-200">
                {filteredProducts.map((p, idx) => {
                  const stock = Number(p.in_stock) || 0;
                  const cost = Number(p.cost) || 0;
                  const price = Number(p.price) || 0;
                  const rowCostTotal = Math.round(stock * cost * 1000) / 1000;
                  const rowRetailTotal = Math.round(stock * price * 1000) / 1000;
                  const isOutOfStock = stock <= 0;

                  return (
                    <tr
                      key={p.id || p.product_code || idx}
                      className="hover:bg-slate-800/50 transition-colors"
                    >
                      {/* Serial Number */}
                      <td className="py-3 px-3 text-center text-slate-500 font-mono text-[11px]">
                        {idx + 1}
                      </td>

                      {/* Photo Thumbnail */}
                      <td className="py-2 px-2 text-center">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.product_name}
                            loading="lazy"
                            className="w-9 h-9 rounded-lg object-cover border border-slate-700 bg-slate-800 mx-auto shadow-sm"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-[10px] font-black text-slate-400 mx-auto">
                            {(p.product_name || 'P').substring(0, 2).toUpperCase()}
                          </div>
                        )}
                      </td>

                      {/* Product Name */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-white text-[13px] leading-tight">
                          {p.product_name}
                        </div>
                        {p.sub_category && (
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Sub: {p.sub_category}
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-3">
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-medium border border-slate-700/60 inline-block">
                          {p.category || 'General'}
                        </span>
                      </td>

                      {/* Barcode / Code */}
                      <td className="py-3 px-3 text-center font-mono text-[11px] text-slate-400">
                        <span className="px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800">
                          {p.barcode || p.product_code || '-'}
                        </span>
                      </td>

                      {/* Cost Price */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-200">
                        {cost > 0 ? (
                          formatAmount(cost, currency)
                        ) : (
                          <span className="text-amber-400 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                            0.000
                          </span>
                        )}
                      </td>

                      {/* Sale Price */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-sky-400">
                        {formatAmount(price, currency)}
                      </td>

                      {/* Stock Quantity */}
                      <td className="py-3 px-3 text-center font-mono font-bold">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] ${
                            isOutOfStock
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          {stock} {p.measurement || 'pcs'}
                        </span>
                      </td>

                      {/* Total Cost Value */}
                      <td className="py-3 px-3 text-right font-mono text-slate-300 font-semibold">
                        {formatAmount(rowCostTotal, currency)}
                      </td>

                      {/* Total Retail Value */}
                      <td className="py-3 px-3 text-right font-mono text-blue-400 font-semibold">
                        {formatAmount(rowRetailTotal, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Slim Footer */}
        <div className="h-9 px-3 sm:px-5 bg-[#1E293B] border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
            <span className="truncate">
              Showing <strong>{filteredProducts.length}</strong> of <strong>{products.length}</strong> items
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] sm:text-[11px] shrink-0 font-mono">
            <span>
              Cost: <strong className="text-blue-400">{currency} {formatAmount(summary.totalCostVal, currency)}</strong>
            </span>
            <span className="text-slate-600">•</span>
            <span>
              Retail: <strong className="text-sky-400">{currency} {formatAmount(summary.totalRetailVal, currency)}</strong>
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
export default ProductReportModal;
