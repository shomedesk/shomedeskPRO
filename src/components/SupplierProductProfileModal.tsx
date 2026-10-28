import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Supplier, SupplierProduct, SalesPlayProduct, SalesPlayCategory } from '@/src/types';
import { 
  getSupplierProducts, 
  linkProductToSupplier, 
  addManualSupplierProduct,
  removeProductFromSupplier, 
  syncSupplierProductsFromHistory 
} from '@/src/services/supplierProductService';
import { fetchSalesPlayProductsWithInventory, fetchSalesPlayCategories } from '@/src/services/salesplay';
import { formatAmount } from '@/src/lib/currencyUtils';
import { 
  Package, 
  X, 
  Search, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Layers, 
  Barcode as BarcodeIcon, 
  DollarSign, 
  Calendar,
  CheckCircle2,
  Tag,
  Building2,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface SupplierProductProfileModalProps {
  supplier: Supplier;
  currency: string;
  businessId: string;
  onClose: () => void;
  onProductsUpdated?: () => void;
}

export function SupplierProductProfileModal({
  supplier,
  currency,
  businessId,
  onClose,
  onProductsUpdated,
}: SupplierProductProfileModalProps) {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [salesPlayCatalog, setSalesPlayCatalog] = useState<SalesPlayProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  // Add product form modal/popover
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [addMode, setAddMode] = useState<'manual' | 'salesplay'>('manual');
  
  // Manual product form state
  const [manualName, setManualName] = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [manualUnit, setManualUnit] = useState<'pcs' | 'kg' | 'box' | 'pack' | 'carton' | 'dozen' | 'ltr' | 'gram'>('pcs');
  const [manualCost, setManualCost] = useState<number>(0);
  const [manualSalesPrice, setManualSalesPrice] = useState<number>(0);

  // SalesPlay product form state
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCatalogProduct, setSelectedCatalogProduct] = useState<SalesPlayProduct | null>(null);
  const [customCost, setCustomCost] = useState<number>(0);
  const [addingProduct, setAddingProduct] = useState(false);

  // Load supplier products
  const loadProducts = async () => {
    if (!supplier.id) return;
    setLoading(true);
    try {
      const list = await getSupplierProducts(supplier.id, businessId, true);
      setProducts(list);
    } catch (err) {
      console.warn('Failed to load supplier products:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, [supplier.id, businessId]);

  const [salesPlayCategories, setSalesPlayCategories] = useState<SalesPlayCategory[]>([]);

  // Load SalesPlay catalog and categories for adding new products
  useEffect(() => {
    async function loadCatalog() {
      try {
        const [prods, cats] = await Promise.all([
          fetchSalesPlayProductsWithInventory(undefined, undefined, true),
          fetchSalesPlayCategories(undefined, true),
        ]);
        setSalesPlayCatalog(prods);
        setSalesPlayCategories(cats);
      } catch (err) {
        console.warn('Failed to load SalesPlay catalog:', err);
      }
    }
    loadCatalog();
  }, []);

  // Distinct Categories across catalog, SalesPlay category API, and existing products
  const allKnownCategories = useMemo(() => {
    const set = new Set<string>();
    salesPlayCategories.forEach(c => { if (c.category_name) set.add(c.category_name.trim()); });
    salesPlayCatalog.forEach(p => { if (p.category) set.add(p.category.trim()); });
    products.forEach(p => { if (p.category) set.add(p.category.trim()); });
    return Array.from(set).sort();
  }, [salesPlayCategories, salesPlayCatalog, products]);

  // Distinct Categories for tabs/filter
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach(p => {
      if (p.category) set.add(p.category.trim());
    });
    return Array.from(set).sort();
  }, [products]);

  // Generate random barcode
  const handleGenerateBarcode = () => {
    const random12 = Math.floor(100000000000 + Math.random() * 900000000000).toString();
    setManualBarcode(random12);
  };

  // Handle Manual Product Submit
  const handleManualProductSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!supplier.id) return;
    if (!manualName.trim()) {
      toast.error('Please enter a product name');
      return;
    }

    setAddingProduct(true);
    try {
      const barcodeToUse = manualBarcode.trim() || Math.floor(100000000000 + Math.random() * 900000000000).toString();
      const categoryToUse = manualCategory.trim() || 'General';

      await addManualSupplierProduct(
        supplier.id,
        supplier.name,
        businessId,
        {
          productName: manualName.trim(),
          category: categoryToUse,
          barcode: barcodeToUse,
          unit: manualUnit,
          cost: Number(manualCost) || 0,
          salesPrice: Number(manualSalesPrice) || 0,
        }
      );

      toast.success(`Product "${manualName.trim()}" added to ${supplier.name}'s profile!`);
      // Reset form
      setManualName('');
      setManualCategory('');
      setManualBarcode('');
      setManualCost(0);
      setManualSalesPrice(0);
      setShowAddProduct(false);

      await loadProducts();
      if (onProductsUpdated) onProductsUpdated();
    } catch (err) {
      console.error('Failed to add manual product:', err);
      toast.error('Failed to add product to supplier profile');
    } finally {
      setAddingProduct(false);
    }
  };

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesCategory = selectedCategory === 'all' || p.category?.toLowerCase() === selectedCategory.toLowerCase();
      if (!matchesCategory) return false;

      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      return (
        p.productName.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.productCode && p.productCode.toLowerCase().includes(term)) ||
        (p.category && p.category.toLowerCase().includes(term))
      );
    });
  }, [products, selectedCategory, searchTerm]);

  // Handle Remove Product from Profile
  const handleRemove = async (prodId: string, name: string) => {
    if (!prodId) return;
    try {
      await removeProductFromSupplier(prodId);
      setProducts(prev => prev.filter(p => p.id !== prodId));
      toast.success(`Removed "${name}" from ${supplier.name}'s profile`);
      if (onProductsUpdated) onProductsUpdated();
    } catch (err) {
      toast.error('Failed to remove product');
    }
  };

  // Sync from past purchase logs
  const handleSyncHistory = async () => {
    if (!supplier.id) return;
    setSyncHistoryToast();
  };

  const setSyncHistoryToast = async () => {
    if (!supplier.id) return;
    setSyncingHistory(true);
    const toastId = toast.loading(`Scanning past purchase bills for ${supplier.name}...`);
    try {
      const count = await syncSupplierProductsFromHistory(supplier.id, businessId);
      await loadProducts();
      toast.success(`Synced ${count} products from previous purchase logs!`, { id: toastId });
      if (onProductsUpdated) onProductsUpdated();
    } catch (err) {
      toast.error('Failed to sync past purchases', { id: toastId });
    } finally {
      setSyncingHistory(false);
    }
  };

  // Handle Add Product from SalesPlay
  const handleAddProductSubmit = async () => {
    if (!supplier.id || !selectedCatalogProduct) return;
    setAddingProduct(true);
    try {
      await linkProductToSupplier(
        supplier.id,
        supplier.name,
        businessId,
        selectedCatalogProduct,
        customCost > 0 ? customCost : selectedCatalogProduct.cost
      );
      toast.success(`Added "${selectedCatalogProduct.product_name}" to supplier catalog!`);
      setSelectedCatalogProduct(null);
      setCatalogSearch('');
      setShowAddProduct(false);
      await loadProducts();
      if (onProductsUpdated) onProductsUpdated();
    } catch (err) {
      toast.error('Failed to link product to supplier');
    } finally {
      setAddingProduct(false);
    }
  };

  // Filter SalesPlay Catalog for picker
  const filteredCatalog = useMemo(() => {
    if (!catalogSearch.trim()) return salesPlayCatalog.slice(0, 15);
    const term = catalogSearch.toLowerCase();
    return salesPlayCatalog
      .filter(p => 
        p.product_name.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.product_code && p.product_code.toLowerCase().includes(term)) ||
        (p.category && p.category.toLowerCase().includes(term))
      )
      .slice(0, 20);
  }, [salesPlayCatalog, catalogSearch]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col relative my-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20">
              <Package size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white">
                  {supplier.name}
                </h3>
                {supplier.category && (
                  <span className="text-[10px] font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                    {supplier.category}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-medium flex items-center gap-2 mt-0.5">
                <span>Product Profile & Supply Catalog</span>
                <span>•</span>
                <span className="text-blue-400 font-bold">{products.length} Products Registered</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSyncHistory}
              disabled={syncingHistory}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all border border-slate-700 cursor-pointer disabled:opacity-50"
              title="Rescan previous purchase logs to add past products"
            >
              <RefreshCw size={13} className={syncingHistory ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Sync Past Purchases</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAddProduct(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-blue-900/30 cursor-pointer active:scale-95"
            >
              <Plus size={14} />
              <span>Add Product</span>
            </button>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Toolbar & Filter Bar */}
        <div className="p-4 bg-slate-950/50 border-b border-slate-800/80 space-y-3">
          <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
            {/* Search Box */}
            <div className="relative w-full sm:w-72">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search products, barcode, SKU..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 outline-none transition-all"
              />
            </div>

            {/* Quick stats & count */}
            <div className="flex items-center gap-3 text-xs text-slate-400 w-full sm:w-auto justify-between sm:justify-end">
              <span>Showing <strong>{filteredProducts.length}</strong> of {products.length} products</span>
            </div>
          </div>

          {/* Category Filter Pills (Actual Categories from SalesPlay) */}
          {categories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`px-3 py-1 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                All Categories ({products.length})
              </button>

              {categories.map(cat => {
                const count = products.filter(p => p.category?.toLowerCase() === cat.toLowerCase()).length;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                      selectedCategory.toLowerCase() === cat.toLowerCase()
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/40'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    <span>{cat}</span>
                    <span className="text-[10px] opacity-70 bg-black/30 px-1.5 py-0.2 rounded-md">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Product Table / List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2">
          {loading ? (
            <div className="p-12 text-center text-slate-400 space-y-3">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
              <p className="text-xs font-bold">Loading supplier product profile...</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="p-12 text-center bg-slate-950/40 border border-slate-800/80 rounded-3xl space-y-3">
              <div className="p-3 bg-slate-800/50 text-slate-400 rounded-2xl w-fit mx-auto">
                <AlertCircle size={28} />
              </div>
              <h4 className="text-sm font-black text-white">No Products In Profile</h4>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {searchTerm || selectedCategory !== 'all'
                  ? 'No products match your search or category filter.'
                  : `No products are currently linked to ${supplier.name}. Products will be automatically added when you log a bill, or you can add products from your SalesPlay catalog right now.`}
              </p>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddProduct(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  Add Product from SalesPlay
                </button>
                <button
                  type="button"
                  onClick={handleSyncHistory}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  Scan Past Bills
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredProducts.map((p, idx) => (
                <div
                  key={p.id || idx}
                  className="bg-slate-950/60 border border-slate-800/80 hover:border-slate-700/80 rounded-2xl p-4 flex flex-col justify-between transition-all group"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h4 className="text-xs sm:text-sm font-black text-white group-hover:text-blue-400 transition-colors line-clamp-1">
                          {p.productName}
                        </h4>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {p.category && (
                            <span className="text-[10px] font-bold bg-blue-950/60 text-blue-300 border border-blue-800/40 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <Tag size={9} />
                              {p.category}
                            </span>
                          )}
                          {p.unit && (
                            <span className="text-[10px] font-mono font-bold bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                              {p.unit}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => p.id && handleRemove(p.id, p.productName)}
                        className="text-slate-500 hover:text-rose-400 p-1.5 hover:bg-rose-950/30 rounded-lg transition-all cursor-pointer opacity-80 group-hover:opacity-100"
                        title="Remove from supplier catalog"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Barcode & SKU */}
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400 font-mono">
                      {p.barcode && (
                        <span className="flex items-center gap-1 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          <BarcodeIcon size={11} className="text-slate-500" />
                          <span>{p.barcode}</span>
                        </span>
                      )}
                      {p.productCode && (
                        <span className="text-slate-500">
                          SKU: {p.productCode}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Financial & Historical Summary */}
                  <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs">
                    <div>
                      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Last Purchase Cost</p>
                      <p className="text-xs sm:text-sm font-black text-emerald-400 font-mono">
                        {currency} {formatAmount(p.lastCost || 0, currency)}
                      </p>
                    </div>

                    {p.salesPrice ? (
                      <div className="text-right">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Selling Price</p>
                        <p className="text-xs font-bold text-slate-300 font-mono">
                          {currency} {formatAmount(p.salesPrice, currency)}
                        </p>
                      </div>
                    ) : null}

                    {p.lastPurchaseDate && (
                      <div className="text-right">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Last Purchased</p>
                        <p className="text-[10px] text-slate-400 font-medium flex items-center gap-1 justify-end">
                          <Calendar size={10} className="text-slate-500" />
                          {format(new Date(p.lastPurchaseDate), 'dd MMM yyyy')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between text-xs">
          <div className="text-slate-400 text-[11px]">
            💡 <em>Tip: During Bill Entry or PO creation, click <strong>"Import All Products"</strong> to add this entire list at once.</em>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all cursor-pointer"
          >
            Done
          </button>
        </div>

        {/* Sub-modal: Add Product (Manual Entry OR SalesPlay Catalog) */}
        {showAddProduct && (
          <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg p-5 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150 my-auto">
              
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
                    <Plus size={16} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white">
                      Add Product to {supplier.name}
                    </h4>
                    <p className="text-[10px] text-slate-400">Map product under this supplier for 1-click PO/Bill import</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddProduct(false);
                    setSelectedCatalogProduct(null);
                  }}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Mode Toggle Tabs */}
              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setAddMode('manual');
                    setSelectedCatalogProduct(null);
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    addMode === 'manual'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Tag size={13} />
                  <span>Manual Product Entry</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('salesplay')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    addMode === 'salesplay'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Package size={13} />
                  <span>From SalesPlay ({salesPlayCatalog.length})</span>
                </button>
              </div>

              {/* MODE 1: Manual Product Entry Form */}
              {addMode === 'manual' && (
                <form onSubmit={handleManualProductSubmit} className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                      <span>Product Name *</span>
                      <span className="text-[9px] text-slate-500 font-normal">e.g. Broiler Chicken, Almarai Milk</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Enter product title..."
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                      autoFocus
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Category
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          list="category-suggestions"
                          placeholder="General / Groceries..."
                          value={manualCategory}
                          onChange={(e) => setManualCategory(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                        />
                        <datalist id="category-suggestions">
                          {allKnownCategories.map(cat => (
                            <option key={cat} value={cat} />
                          ))}
                        </datalist>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Unit of Measurement
                      </label>
                      <select
                        value={manualUnit}
                        onChange={(e) => setManualUnit(e.target.value as any)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-indigo-400 font-bold outline-none focus:border-blue-500"
                      >
                        <option value="pcs">pcs (Pieces / Items)</option>
                        <option value="kg">kg (Kilogram - Weighted)</option>
                        <option value="gram">gram (Grams)</option>
                        <option value="box">box (Boxes)</option>
                        <option value="carton">carton (Cartons)</option>
                        <option value="pack">pack (Packets)</option>
                        <option value="dozen">dozen (Dozens)</option>
                        <option value="ltr">ltr (Liters)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
                      <span>Barcode / SKU (Optional)</span>
                      <button
                        type="button"
                        onClick={handleGenerateBarcode}
                        className="text-[10px] text-blue-400 hover:text-blue-300 font-bold underline cursor-pointer"
                      >
                        🎲 Auto Generate
                      </button>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 890123456789 or auto generated"
                      value={manualBarcode}
                      onChange={(e) => setManualBarcode(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:border-blue-500 outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Purchase Cost ({currency}) *
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0.000"
                        value={manualCost === 0 ? '' : manualCost}
                        onChange={(e) => setManualCost(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono font-bold text-white placeholder-slate-600 focus:border-blue-500 outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Sales Price ({currency})
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="0.000"
                        value={manualSalesPrice === 0 ? '' : manualSalesPrice}
                        onChange={(e) => setManualSalesPrice(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono font-bold text-emerald-400 placeholder-slate-600 focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowAddProduct(false)}
                      className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={addingProduct || !manualName.trim()}
                      className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl transition-all shadow-lg shadow-blue-900/30 cursor-pointer disabled:opacity-50"
                    >
                      {addingProduct ? 'Saving...' : 'Save Product to Supplier'}
                    </button>
                  </div>
                </form>
              )}

              {/* MODE 2: SalesPlay Catalog Picker */}
              {addMode === 'salesplay' && (
                <>
                  {!selectedCatalogProduct ? (
                    <div className="space-y-3">
                      <div className="relative">
                        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          placeholder="Search SalesPlay inventory by name, code, barcode..."
                          value={catalogSearch}
                          onChange={(e) => setCatalogSearch(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                          autoFocus
                        />
                      </div>

                      <div className="max-h-60 overflow-y-auto space-y-1.5 divide-y divide-slate-800/50">
                        {filteredCatalog.map(item => (
                          <div
                            key={item.id}
                            onClick={() => {
                              setSelectedCatalogProduct(item);
                              setCustomCost(item.cost || 0);
                            }}
                            className="p-2.5 hover:bg-slate-800/60 rounded-xl cursor-pointer transition-all flex items-center justify-between"
                          >
                            <div>
                              <p className="text-xs font-bold text-white">{item.product_name}</p>
                              <p className="text-[10px] text-slate-400 flex items-center gap-2">
                                <span className="bg-slate-800 text-blue-300 px-1.5 py-0.5 rounded text-[9px] font-bold">
                                  {item.category || 'General'}
                                </span>
                                {item.barcode && <span>• Barcode: {item.barcode}</span>}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-mono font-bold text-emerald-400">
                                {currency} {formatAmount(item.cost || 0, currency)}
                              </p>
                              <p className="text-[9px] text-slate-500 uppercase">Cost</p>
                            </div>
                          </div>
                        ))}
                        {filteredCatalog.length === 0 && (
                          <div className="text-center py-6 space-y-2">
                            <p className="text-xs text-slate-500">No products found in SalesPlay catalog</p>
                            <button
                              type="button"
                              onClick={() => setAddMode('manual')}
                              className="text-xs text-blue-400 hover:text-blue-300 underline font-bold"
                            >
                              Switch to Manual Product Entry
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Step 2: Confirm Cost & Link */
                    <div className="space-y-4">
                      <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                        <p className="text-xs font-black text-white">{selectedCatalogProduct.product_name}</p>
                        <p className="text-[10px] text-slate-400">
                          Category: <span className="text-blue-400 font-bold">{selectedCatalogProduct.category || 'General'}</span> • Barcode: {selectedCatalogProduct.barcode || 'N/A'}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          Default Purchase Cost ({currency})
                        </label>
                        <input
                          type="number"
                          step="any"
                          min={0}
                          value={customCost || ''}
                          onChange={(e) => setCustomCost(parseFloat(e.target.value) || 0)}
                          placeholder="0.000"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white font-mono outline-none focus:border-blue-500"
                        />
                        <p className="text-[10px] text-slate-500">
                          You can modify this cost anytime when creating a specific bill.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setSelectedCatalogProduct(null)}
                          className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all cursor-pointer"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={handleAddProductSubmit}
                          disabled={addingProduct}
                          className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl transition-all shadow-lg shadow-blue-900/30 cursor-pointer disabled:opacity-50"
                        >
                          {addingProduct ? 'Linking...' : 'Confirm & Add'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        )}

      </div>
    </div>,
    document.body
  );
}
