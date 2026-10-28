import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '@/src/lib/firebase';
import {
  collection,
  addDoc,
  query,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  doc,
  deleteDoc,
  where
} from 'firebase/firestore';
import {
  Supplier,
  Branch,
  Business,
  PurchaseOrder,
  PurchaseOrderItem,
  SalesPlayProduct,
  SupplierProduct
} from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import {
  FileText,
  Plus,
  Trash2,
  Printer,
  Barcode as BarcodeIcon,
  Search,
  CheckCircle2,
  Clock,
  ArrowRight,
  Package,
  Eye,
  X,
  AlertCircle,
  Download,
  Zap
} from 'lucide-react';
import { format } from 'date-fns';
import { Barcode } from './Barcode';
import { ProductSearchAndScan } from './ProductSearchAndScan';
import { fetchSalesPlayProductsWithInventory, FALLBACK_SALESPLAY_PRODUCTS } from '@/src/services/salesplay';
import { cn } from '@/src/lib/utils';
import { formatAmount, isWeightItem, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import { generatePoPdf } from '@/src/lib/pdfUtils';
import { SupplierProductProfileModal } from './SupplierProductProfileModal';
import {
  getSupplierProducts,
  saveSupplierProductsFromBill
} from '@/src/services/supplierProductService';

interface PurchaseOrderManagerProps {
  suppliers: Supplier[];
  branches: Branch[];
  currency: string;
  onSelectForBillEntry?: (po: PurchaseOrder) => void;
}

export function PurchaseOrderManager({
  suppliers,
  branches,
  currency,
  onSelectForBillEntry,
}: PurchaseOrderManagerProps) {
  const { selectedBusiness, selectedBranch, businesses, isAllBusinessesSelected, userProfile } = useBusiness();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [salesPlayProducts, setSalesPlayProducts] = useState<SalesPlayProduct[]>(FALLBACK_SALESPLAY_PRODUCTS);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form State
  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);

  // Supplier Products Catalog State
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [loadingSupplierProducts, setLoadingSupplierProducts] = useState(false);
  const [viewingProfileSupplier, setViewingProfileSupplier] = useState<Supplier | null>(null);

  // Detailed Modal view
  const [viewingPO, setViewingPO] = useState<PurchaseOrder | null>(null);

  const activeBusiness = useMemo(() => {
    return selectedBusiness || (businesses.length > 0 ? businesses[0] : null);
  }, [selectedBusiness, businesses]);

  // Helper to calculate next clean short PO number (PO-001, PO-002, PO-003...)
  const getNextShortPoNumber = (orders: PurchaseOrder[]): string => {
    let maxNum = 0;
    orders.forEach((p) => {
      if (p.poNumber) {
        // Match numbers like PO-001, PO-1, PO-002 (ignore old timestamp style numbers)
        const match = p.poNumber.match(/^PO-0*([1-9]\d{0,4})$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    });
    const nextNum = maxNum + 1;
    return `PO-${String(nextNum).padStart(3, '0')}`;
  };

  // Initial PO Number generation - Short professional sequence (PO-001, PO-002...)
  useEffect(() => {
    if (!poNumber || poNumber.startsWith('PO-202')) {
      setPoNumber(getNextShortPoNumber(purchaseOrders));
    }
  }, [purchaseOrders]);

  // Load SalesPlay Products for rapid autocomplete & scanning
  useEffect(() => {
    let isMounted = true;
    async function loadProducts() {
      if (!activeBusiness) return;
      setLoadingProducts(true);
      try {
        const prods = await fetchSalesPlayProductsWithInventory(undefined, undefined, true);
        if (isMounted) {
          setSalesPlayProducts(prods);
        }
      } catch (err) {
        console.error('Failed to load SalesPlay products for PO:', err);
      } finally {
        if (isMounted) setLoadingProducts(false);
      }
    }
    loadProducts();
    return () => {
      isMounted = false;
    };
  }, [activeBusiness]);

  // Sync default branch
  useEffect(() => {
    if (selectedBranch) {
      setBranchId(selectedBranch.id);
    } else if (branches.length > 0 && !branchId) {
      setBranchId(branches[0].id);
    }
  }, [selectedBranch, branches, branchId]);

  // Load Supplier's Product Profile whenever a supplier is chosen
  useEffect(() => {
    if (!supplierId) {
      setSupplierProducts([]);
      return;
    }
    let isMounted = true;
    setLoadingSupplierProducts(true);
    getSupplierProducts(supplierId, activeBusiness?.id, true)
      .then((prods) => {
        if (isMounted) {
          setSupplierProducts(prods);
          setLoadingSupplierProducts(false);
        }
      })
      .catch(() => {
        if (isMounted) setLoadingSupplierProducts(false);
      });
    return () => {
      isMounted = false;
    };
  }, [supplierId, activeBusiness?.id]);

  // Import all products from this supplier's catalog into the current Purchase Order
  const handleImportAllSupplierProducts = () => {
    if (supplierProducts.length === 0) {
      toast.info('No products found in this supplier catalog yet.');
      return;
    }

    const selectedSup = suppliers.find(s => s.id === supplierId);
    const newItems: PurchaseOrderItem[] = supplierProducts.map((sp, idx) => {
      const isWeight = sp.unit === 'kg' || isWeightItem(sp.productName);
      const defaultQty = isWeight ? 1.000 : 1;
      const unitCost = Number(sp.lastCost) || 0;
      return {
        id: `item-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 5)}`,
        productId: sp.productId || '',
        productCode: sp.productCode || '',
        name: sp.productName,
        barcode: sp.barcode || '',
        category: sp.category || 'General',
        unit: (sp.unit as any) || (isWeight ? 'kg' : 'pcs'),
        quantity: toStrictDecimal3(defaultQty),
        unitPrice: toStrictDecimal3(unitCost),
        salesPrice: toStrictDecimal3(sp.salesPrice || 0),
        totalPrice: toStrictDecimal3(defaultQty * unitCost),
        currentStock: 0,
        measurement: (sp.unit as any) || (isWeight ? 'kg' : 'pcs'),
      };
    });

    setItems(newItems);
    toast.success(
      `Imported all ${newItems.length} products from ${selectedSup?.name || 'supplier'}'s catalog! Adjust qty, cost, or delete items as needed.`
    );
  };

  // Listen to Purchase Orders
  useEffect(() => {
    if (!activeBusiness) return;

    let q = query(
      collection(db, 'purchaseOrders'),
      where('businessId', '==', activeBusiness.id)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const pos: PurchaseOrder[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        } as PurchaseOrder));

        pos.sort((a, b) => {
          const timeA = a.createdAt?.seconds || 0;
          const timeB = b.createdAt?.seconds || 0;
          return timeB - timeA;
        });

        setPurchaseOrders(pos);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'purchaseOrders');
      }
    );

    return () => unsub();
  }, [activeBusiness]);

  // Add item from SalesPlay Product selection
  const handleSelectProduct = (product: SalesPlayProduct) => {
    const existingIndex = items.findIndex(
      (item) => item.productId === product.id || (product.barcode && item.barcode === product.barcode)
    );

    const isWeight = isWeightItem(product.product_name, product.measurement);
    const unit = isWeight ? 'kg' : (product.measurement || 'pcs');

    if (existingIndex >= 0) {
      const updated = [...items];
      const incrementVal = updated[existingIndex].unit === 'kg' ? 1.000 : 1;
      updated[existingIndex].quantity = toStrictDecimal3(Number(updated[existingIndex].quantity || 0) + incrementVal);
      updated[existingIndex].totalPrice = toStrictDecimal3(updated[existingIndex].quantity * updated[existingIndex].unitPrice);
      setItems(updated);
      toast.success(`Incremented quantity for "${product.product_name}"`);
    } else {
      // REQUIREMENT 6: Use purchase_cost or last_purchase_cost, NEVER sales price
      const unitCost = Number(product.last_purchase_cost ?? product.cost ?? 0);
      const salesPrice = Number(product.price || 0);
      const initialQty = isWeight ? 1.000 : 1;
      const initialTotal = toStrictDecimal3(initialQty * unitCost);

      const newItem: PurchaseOrderItem = {
        id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        productId: product.id,
        productCode: product.product_code,
        name: product.product_name,
        barcode: product.barcode || '',
        category: product.category || '',
        unit,
        quantity: initialQty,
        unitPrice: unitCost,
        salesPrice: salesPrice,
        totalPrice: initialTotal,
        currentStock: Number(product.in_stock || 0),
        measurement: unit,
      };
      setItems([...items, newItem]);
    }
  };

  // Add custom unlisted item with scanned barcode
  const handleAddCustomWithBarcode = (barcode: string) => {
    const newItem: PurchaseOrderItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: `Custom Product (${barcode})`,
      barcode: barcode,
      category: 'General',
      unit: 'pcs',
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
    };
    setItems([...items, newItem]);
  };

  // Add Manual blank item
  const handleAddManualItem = () => {
    const newItem: PurchaseOrderItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: '',
      barcode: '',
      category: '',
      unit: 'pcs',
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
    };
    setItems([...items, newItem]);
  };

  const handleUpdateItem = (index: number, field: keyof PurchaseOrderItem, value: any) => {
    const updated = [...items];
    const current = { ...updated[index] };

    if (field === 'orderMode') {
      const newMode = (value as 'pcs' | 'pack');
      current.orderMode = newMode;
      if (newMode === 'pack') {
        current.unit = 'pack';
        current.piecesPerPack = current.piecesPerPack && current.piecesPerPack > 0 ? current.piecesPerPack : 24;
        current.packCount = current.packCount && current.packCount > 0 ? current.packCount : Math.max(1, Math.round((Number(current.quantity) || 24) / current.piecesPerPack));
        current.quantity = Math.round(current.packCount * current.piecesPerPack * 1000) / 1000;
        if (!current.packPrice || current.packPrice <= 0) {
          current.packPrice = Math.round((Number(current.unitPrice) || 0) * current.piecesPerPack * 1000) / 1000;
        }
        current.totalPrice = toStrictDecimal3(current.packCount * current.packPrice);
      } else {
        current.unit = 'pcs';
        current.quantity = Number(current.quantity) || 1;
        current.unitPrice = Number(current.unitPrice) || 0;
        current.totalPrice = toStrictDecimal3(current.quantity * current.unitPrice);
      }
    } else if (current.orderMode === 'pack') {
      if (field === 'packCount') {
        const pCount = Math.max(0, parseFloat(value) || 0);
        current.packCount = pCount;
        const pPerPack = Math.max(1, Number(current.piecesPerPack) || 24);
        current.quantity = Math.round(pCount * pPerPack * 1000) / 1000;
        const pPrice = Number(current.packPrice) || 0;
        current.totalPrice = toStrictDecimal3(pCount * pPrice);
        current.unitPrice = pPerPack > 0 ? Math.round((pPrice / pPerPack) * 10000) / 10000 : 0;
      } else if (field === 'piecesPerPack') {
        const pPerPack = Math.max(1, parseInt(value) || 1);
        current.piecesPerPack = pPerPack;
        const pCount = Number(current.packCount) || 0;
        current.quantity = Math.round(pCount * pPerPack * 1000) / 1000;
        const pPrice = Number(current.packPrice) || 0;
        current.unitPrice = pPerPack > 0 ? Math.round((pPrice / pPerPack) * 10000) / 10000 : 0;
        current.totalPrice = toStrictDecimal3(pCount * pPrice);
      } else if (field === 'packPrice') {
        const pPrice = Math.max(0, parseFloat(value) || 0);
        current.packPrice = pPrice;
        const pCount = Number(current.packCount) || 0;
        const pPerPack = Math.max(1, Number(current.piecesPerPack) || 24);
        current.unitPrice = pPerPack > 0 ? Math.round((pPrice / pPerPack) * 10000) / 10000 : 0;
        current.totalPrice = toStrictDecimal3(pCount * pPrice);
      } else if (field === 'quantity') {
        const q = Math.max(0, parseFloat(value) || 0);
        current.quantity = q;
        const pPerPack = Math.max(1, Number(current.piecesPerPack) || 24);
        current.packCount = pPerPack > 0 ? Math.round((q / pPerPack) * 100) / 100 : 0;
        const pPrice = Number(current.packPrice) || 0;
        current.totalPrice = toStrictDecimal3(current.packCount * pPrice);
      } else if (field === 'unitPrice') {
        const u = Math.max(0, parseFloat(value) || 0);
        current.unitPrice = u;
        const pPerPack = Math.max(1, Number(current.piecesPerPack) || 24);
        current.packPrice = Math.round(u * pPerPack * 1000) / 1000;
        current.totalPrice = toStrictDecimal3(Number(current.quantity) * u);
      } else {
        (current as any)[field] = value;
      }
    } else {
      (current as any)[field] = value;
      if (field === 'quantity' || field === 'unitPrice') {
        const q = Number(current.quantity) || 0;
        const p = Number(current.unitPrice) || 0;
        current.totalPrice = toStrictDecimal3(q * p);
      }
    }

    updated[index] = current;
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const totalPOAmount = useMemo(() => {
    return toStrictDecimal3(items.reduce((acc, i) => acc + (Number(i.totalPrice) || 0), 0));
  }, [items]);

  const handleSubmitPO = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!activeBusiness) {
      toast.error('Please select a business first');
      return;
    }
    if (!supplierId) {
      toast.error('Please select a Supplier / Party (দয়া করে একজন সাপ্লায়ার / পার্টি সিলেক্ট করুন)');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one product item to the Purchase Order');
      return;
    }

    const selectedSup = suppliers.find(s => s.id === supplierId);

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        businessId: activeBusiness.id,
        ownerId: activeBusiness.ownerId || auth.currentUser?.uid || '',
        branchId: branchId || 'main',
        poNumber: poNumber.trim(),
        supplierId,
        supplierName: selectedSup?.name || 'Unknown',
        supplierPhone: selectedSup?.phone || '',
        supplierAddress: selectedSup?.address || '',
        items: items.map(i => ({
          id: i.id,
          productId: i.productId || '',
          productCode: i.productCode || '',
          name: i.name.trim() || 'Item',
          barcode: (i.barcode || '').trim(),
          category: i.category || '',
          unit: i.unit || 'pcs',
          quantity: toStrictDecimal3(i.quantity || 1),
          unitPrice: toStrictDecimal3(i.unitPrice || 0),
          salesPrice: toStrictDecimal3(i.salesPrice || 0),
          totalPrice: toStrictDecimal3(i.totalPrice || 0),
          currentStock: Number(i.currentStock) || 0,
          measurement: i.unit || i.measurement || 'pcs',
        })),
        totalAmount: totalPOAmount,
        status: 'pending',
        expectedDate: expectedDate || format(new Date(), 'yyyy-MM-dd'),
        notes: notes.trim(),
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'purchaseOrders'), payload);
      toast.success(`Purchase Order ${poNumber} created successfully!`);

      // Automatically sync purchased items into Supplier's Product Profile Catalog with latest costs
      if (items.length > 0 && supplierId) {
        try {
          await saveSupplierProductsFromBill(
            supplierId,
            selectedSup?.name || 'Supplier',
            activeBusiness.id,
            items,
            expectedDate || new Date().toISOString()
          );
        } catch (syncErr) {
          console.warn('Supplier product catalog auto-sync notice from PO:', syncErr);
        }
      }

      // Immediately open printable PO Bill modal for the newly generated order!
      setViewingPO({ id: docRef.id, ...payload } as any);

      // Reset form
      setItems([]);
      setPoNumber(getNextShortPoNumber(purchaseOrders));
      setNotes('');
      setIsCreating(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'purchaseOrders');
      toast.error('Failed to create purchase order');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePO = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'purchaseOrders', id));
      toast.success('Purchase Order deleted');
      if (viewingPO?.id === id) setViewingPO(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'purchaseOrders');
      toast.error('Failed to delete Purchase Order');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3 text-indigo-400">
          <FileText size={28} />
          <div>
            <h2 className="text-base font-black uppercase tracking-wider text-slate-100">
              Purchase Orders (PO)
            </h2>
            <p className="text-xs text-slate-400">
              Create product & supplier wise bills with real-time scannable barcodes and SalesPlay sync
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsCreating(!isCreating)}
          className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-5 rounded-2xl shadow-lg transition-all cursor-pointer active:scale-95 text-xs"
        >
          {isCreating ? <X size={16} /> : <Plus size={16} />}
          {isCreating ? 'Close Creator' : 'Create Purchase Order'}
        </button>
      </div>

      {/* Purchase Order Creator Form (Pure div to avoid form reload on barcode enter) */}
      {isCreating && (
        <div
          role="region"
          aria-label="New Purchase Order Details"
          className="bg-[#1E293B] p-6 rounded-3xl border border-indigo-500/30 shadow-2xl space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <h3 className="text-sm font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
              <Package size={18} /> New Purchase Order Details
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PO Number:</span>
              <input 
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="text-xs font-mono font-bold bg-indigo-950/60 text-indigo-300 px-3 py-1.5 rounded-xl border border-indigo-700/60 outline-none w-28 text-center focus:border-indigo-400"
                placeholder="PO-001"
              />
              <button
                type="button"
                onClick={() => setPoNumber('PO-001')}
                className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-xl font-bold transition-colors cursor-pointer"
                title="Reset sequence to PO-001"
              >
                Reset to PO-001
              </button>
            </div>
          </div>

          {/* Supplier & Branch Config */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Target Branch *
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name} ({b.branchCode || 'BR'})</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Select Supplier / Party (সাপ্লায়ার / পার্টি) *
                </label>
                {supplierId && (
                  <span className="text-[10px] text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                    Party: {suppliers.find(s => s.id === supplierId)?.name}
                  </span>
                )}
              </div>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
              >
                <option value="">-- Choose Supplier / Party ({suppliers.length}) --</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Expected Date
              </label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {/* 🌟 Supplier Product Catalog & 1-Click Import Banner */}
          {supplierId && (
            <div className="bg-gradient-to-r from-blue-950/70 via-indigo-950/60 to-purple-950/70 border border-blue-500/30 p-4 rounded-2xl space-y-3 shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3">
                  <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl shrink-0 mt-0.5 sm:mt-0">
                    <Zap size={18} className="animate-pulse" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs sm:text-sm font-black text-white">
                        {suppliers.find(s => s.id === supplierId)?.name}'s Product Catalog
                      </h4>
                      <span className="text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full">
                        {supplierProducts.length} Products
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 font-medium">
                      {supplierProducts.length > 0 
                        ? `Import all ${supplierProducts.length} products into this PO at once with actual categories and cost prices. You can modify quantities, change costs, or delete items below.`
                        : `No products mapped to this supplier yet. Products added to this PO will be saved to their profile automatically.`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                  {supplierProducts.length > 0 && (
                    <button
                      type="button"
                      onClick={handleImportAllSupplierProducts}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-black px-4 py-2.5 rounded-xl text-xs shadow-lg shadow-blue-950/40 transition-all cursor-pointer active:scale-95 border border-blue-400/30"
                      title="Import all products from supplier catalog"
                    >
                      <Download size={14} />
                      <span>Import All ({supplierProducts.length})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const sup = suppliers.find(s => s.id === supplierId);
                      if (sup) setViewingProfileSupplier(sup);
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold rounded-xl border border-slate-700/80 transition-all cursor-pointer"
                    title="View supplier catalog profile"
                  >
                    <Package size={14} />
                    <span className="hidden md:inline">Manage</span> Catalog
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Product Picker Section: Barcode Scanner Gun + Camera Scan + Search Dropdown */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <BarcodeIcon size={16} className="text-indigo-400" />
                Product Search & Barcode Scan
              </label>
              <button
                type="button"
                onClick={handleAddManualItem}
                className="text-xs font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                <Plus size={14} /> Add Custom Product
              </button>
            </div>

            <ProductSearchAndScan
              products={salesPlayProducts}
              onSelectProduct={handleSelectProduct}
              onAddCustomWithBarcode={handleAddCustomWithBarcode}
              currency={currency}
            />
          </div>

          {/* Selected Order Items Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-300">
                Order Items ({items.length})
              </h4>
              <div className="flex items-center gap-3">
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setItems([]);
                      toast.info('Cleared all items from purchase order');
                    }}
                    className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 font-bold px-2 py-1 rounded hover:bg-rose-950/30 transition-all cursor-pointer"
                  >
                    <Trash2 size={12} /> Clear All
                  </button>
                )}
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Barcodes are automatically formatted for print & laser scanner verification
                </span>
              </div>
            </div>

            {items.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex md:hidden items-center justify-between px-3 py-1.5 bg-indigo-950/40 border border-indigo-500/20 rounded-xl text-[11px] text-indigo-300">
                  <span className="font-semibold">👉 Swipe sideways to view & edit all item columns</span>
                  <span className="font-mono font-bold text-indigo-400">{items.length} items</span>
                </div>
                <div className="border border-slate-800 rounded-2xl overflow-x-auto overflow-y-hidden bg-slate-900/40 scrollbar-thin">
                  <table className="w-full min-w-[960px] text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900/80 border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                        <th className="py-3 px-3 w-10">#</th>
                        <th className="py-3 px-3 min-w-[190px]">Product Name</th>
                        <th className="py-3 px-3 min-w-[130px]">Barcode</th>
                        <th className="py-3 px-3 min-w-[110px] text-center">Barcode</th>
                        <th className="py-3 px-3 w-32 text-center">Unit / Mode</th>
                        <th className="py-3 px-3 min-w-[210px] text-right">Quantity / Packs</th>
                        <th className="py-3 px-3 min-w-[140px] text-right">Cost ({currency})</th>
                        <th className="py-3 px-3 min-w-[100px] text-right">Subtotal</th>
                        <th className="py-3 px-3 w-12 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {items.map((item, idx) => {
                        const isPack = item.orderMode === 'pack';
                        const isKg = item.unit === 'kg';
                        return (
                          <tr key={item.id} className="hover:bg-slate-800/30">
                            <td className="py-3 px-3 text-slate-500 font-mono">{idx + 1}</td>
                            <td className="py-3 px-3">
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) => handleUpdateItem(idx, 'name', e.target.value)}
                                placeholder="Product name"
                                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-slate-100 outline-none focus:border-indigo-500 min-w-[170px]"
                                required
                              />
                            </td>
                            <td className="py-3 px-3">
                              <input
                                type="text"
                                value={item.barcode || ''}
                                onChange={(e) => handleUpdateItem(idx, 'barcode', e.target.value)}
                                placeholder="Barcode"
                                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs font-mono text-slate-300 outline-none focus:border-indigo-500 min-w-[120px]"
                              />
                            </td>
                            <td className="py-3 px-3 text-center">
                              {item.barcode ? (
                                <Barcode value={item.barcode} height={22} width={1.0} fontSize={8} />
                              ) : (
                                <span className="text-[10px] text-slate-500 italic">No code</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <select
                                value={isPack ? 'pack' : (item.unit || 'pcs')}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === 'pack') {
                                    handleUpdateItem(idx, 'orderMode', 'pack');
                                  } else {
                                    if (isPack) {
                                      handleUpdateItem(idx, 'orderMode', 'pcs');
                                    }
                                    handleUpdateItem(idx, 'unit', val);
                                  }
                                }}
                                className={`w-full bg-slate-900 border rounded-lg p-1.5 text-xs font-bold outline-none cursor-pointer ${
                                  isPack ? 'border-amber-500/50 text-amber-300 bg-amber-950/20' : 'border-slate-800 text-indigo-400'
                                }`}
                              >
                                <option value="pcs">Pcs (পিস)</option>
                                <option value="pack">📦 Pack (প্যাক/কার্টন)</option>
                                <option value="kg">Kg (কেজি)</option>
                              </select>
                            </td>
                            <td className="py-3 px-3">
                              {isPack ? (
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center justify-end gap-1">
                                    <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-1 rounded-lg border border-slate-800">
                                      <span className="text-[10px] text-amber-400 font-bold">Packs:</span>
                                      <input
                                        type="number"
                                        min="0.01"
                                        step="1"
                                        value={item.packCount ?? ''}
                                        onChange={(e) => handleUpdateItem(idx, 'packCount', e.target.value)}
                                        placeholder="5"
                                        className="w-12 bg-transparent text-xs text-center text-amber-300 font-black outline-none"
                                        title="Number of packs/cartons"
                                      />
                                    </div>
                                    <span className="text-slate-500 font-black">×</span>
                                    <div className="flex items-center gap-1 bg-slate-950/80 px-1.5 py-1 rounded-lg border border-slate-800">
                                      <span className="text-[10px] text-indigo-300 font-bold">Pcs/Pk:</span>
                                      <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={item.piecesPerPack ?? ''}
                                        onChange={(e) => handleUpdateItem(idx, 'piecesPerPack', e.target.value)}
                                        placeholder="24"
                                        className="w-12 bg-transparent text-xs text-center text-indigo-300 font-black outline-none"
                                        title="Pieces inside each pack"
                                      />
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    = {item.quantity || 0} pcs total
                                  </span>
                                </div>
                              ) : (
                                <input
                                  type="number"
                                  min="0.001"
                                  step={isKg ? '0.001' : '1'}
                                  value={item.quantity}
                                  onChange={(e) => handleUpdateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                  placeholder={isKg ? '0.000' : '1'}
                                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-slate-100 text-right outline-none focus:border-indigo-500 font-bold font-mono min-w-[80px]"
                                  required
                                />
                              )}
                            </td>
                            <td className="py-3 px-3">
                              {isPack ? (
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center gap-1 justify-end">
                                    <span className="text-[10px] text-amber-400 font-semibold">/Pack:</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.001"
                                      value={item.packPrice === undefined || item.packPrice === 0 ? '' : item.packPrice}
                                      onChange={(e) => handleUpdateItem(idx, 'packPrice', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                                      placeholder="0.000"
                                      className="w-20 bg-slate-950 border border-amber-500/40 focus:border-amber-400 rounded-lg p-1.5 text-xs text-right text-amber-300 font-mono font-bold outline-none"
                                      title="Price per pack / carton"
                                      required
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    (={formatAmount(item.unitPrice || 0, currency)}/pc)
                                  </span>
                                </div>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.001"
                                  value={item.unitPrice === 0 ? '' : item.unitPrice}
                                  onChange={(e) => handleUpdateItem(idx, 'unitPrice', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                                  placeholder="0.000"
                                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-slate-100 text-right outline-none focus:border-indigo-500 font-bold font-mono min-w-[90px]"
                                  required
                                />
                              )}
                            </td>
                            <td className="py-3 px-3 text-right font-black font-mono text-indigo-400 whitespace-nowrap">
                              {currency} {formatAmount(item.totalPrice || 0, currency)}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(idx)}
                                className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg transition-all cursor-pointer"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/20 text-slate-500 text-xs font-medium">
                No items added yet. Click on any SalesPlay item above or "Add Custom Product".
              </div>
            )}
          </div>

          {/* Notes and Total */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                Order Notes / Terms
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special delivery instructions, terms, payment agreements..."
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500 h-20 resize-none"
              />
            </div>
            <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-2 text-right">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Total Purchase Order Amount
              </p>
              <p className="text-2xl font-black font-mono text-indigo-400">
                {currency} {formatAmount(totalPOAmount, currency)}
              </p>
              <p className="text-[10px] text-slate-500">
                {items.length} items • Generated with printable real-time barcodes
              </p>
            </div>
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmitPO}
            disabled={saving || items.length === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-indigo-900/30 cursor-pointer"
          >
            {saving ? (
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div>
            ) : (
              <FileText size={20} />
            )}
            Save & Generate Purchase Order Bill
          </button>
        </div>
      )}

      {/* Purchase Orders List */}
      <div className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <FileText size={18} />
            <h3 className="text-xs font-black uppercase tracking-[0.2em]">
              Recent Purchase Orders ({purchaseOrders.length})
            </h3>
          </div>
        </div>

        <div className="space-y-3">
          {purchaseOrders.map(po => {
            const branchName = branches.find(b => b.id === po.branchId)?.name || 'Main Branch';
            const isFulfilled = po.status === 'fulfilled';

            return (
              <div
                key={po.id}
                className="p-5 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-indigo-400 text-sm">
                      {po.poNumber}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full flex items-center gap-1",
                        isFulfilled
                          ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800"
                          : "bg-amber-950/60 text-amber-400 border border-amber-800"
                      )}
                    >
                      {isFulfilled ? <CheckCircle2 size={11} /> : <Clock size={11} />}
                      {isFulfilled ? 'Fulfilled (Invoiced)' : 'Pending Bill'}
                    </span>
                  </div>

                  <p className="text-sm font-bold text-slate-200">{po.supplierName}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <span>{branchName}</span>
                    <span>•</span>
                    <span>{po.items ? `${po.items.length} Products` : 'Items'}</span>
                    <span>•</span>
                    <span>
                      {po.createdAt?.toDate
                        ? format(po.createdAt.toDate(), 'MMM dd, yyyy')
                        : 'Recent'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end md:self-auto">
                  <div className="text-right mr-2">
                    <p className="text-base font-black font-mono text-indigo-400">
                      {currency} {formatAmount(po.totalAmount || 0, currency)}
                    </p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Value</p>
                  </div>

                  {/* Download PO button */}
                  <button
                    type="button"
                    onClick={() => generatePoPdf({ po, business: activeBusiness, branch: branches.find(b => b.id === po.branchId), currency })}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black py-2.5 px-3.5 rounded-xl shadow-md shadow-indigo-950/40 transition-all cursor-pointer active:scale-95"
                    title="Download vector PO Bill with Barcodes"
                  >
                    <Download size={15} />
                    Download PDF
                  </button>

                  <button
                    type="button"
                    onClick={() => setViewingPO(po)}
                    className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2.5 px-3 rounded-xl border border-slate-700 transition-all cursor-pointer active:scale-95"
                    title="View PO Details"
                  >
                    <Eye size={15} />
                    View
                  </button>

                  {/* Convert / Use in Bill Entry */}
                  {!isFulfilled && onSelectForBillEntry && (
                    <button
                      type="button"
                      onClick={() => onSelectForBillEntry(po)}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2.5 px-3.5 rounded-xl shadow-lg transition-all cursor-pointer active:scale-95"
                      title="Import into Bill Entry form"
                    >
                      <ArrowRight size={15} />
                      Log Bill
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => po.id && handleDeletePO(po.id)}
                    className="text-slate-500 hover:text-rose-400 p-2 rounded-xl transition-all cursor-pointer"
                    title="Delete PO"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}

          {purchaseOrders.length === 0 && (
            <div className="p-12 text-center text-slate-500 font-bold uppercase tracking-widest text-xs">
              No purchase orders created yet. Click "Create Purchase Order" above to begin.
            </div>
          )}
        </div>
      </div>

      {/* PO View & Print Modal */}
      {viewingPO && (
        <PurchaseOrderBillModal
          po={viewingPO}
          currency={currency}
          business={activeBusiness}
          branch={branches.find(b => b.id === viewingPO.branchId)}
          onClose={() => setViewingPO(null)}
          onUseInBillEntry={() => {
            if (onSelectForBillEntry) {
              onSelectForBillEntry(viewingPO);
              setViewingPO(null);
            }
          }}
        />
      )}

      {/* Supplier Products Profile Catalog Modal */}
      {viewingProfileSupplier && (
        <SupplierProductProfileModal
          supplier={viewingProfileSupplier}
          currency={currency}
          businessId={activeBusiness?.id || ''}
          onClose={() => setViewingProfileSupplier(null)}
          onProductsUpdated={() => {
            if (supplierId) {
              getSupplierProducts(supplierId, activeBusiness?.id, false).then(setSupplierProducts);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Printable / Downloadable Purchase Order Bill Document with Real-Time Barcodes
 */
function PurchaseOrderBillModal({
  po,
  currency,
  business,
  branch,
  onClose,
  onUseInBillEntry,
}: {
  po: PurchaseOrder;
  currency: string;
  business?: Business | null;
  branch?: Branch | null;
  onClose: () => void;
  onUseInBillEntry?: () => void;
}) {
  const handleDownloadPdf = () => {
    generatePoPdf({ po, business, branch, currency });
  };

  const createdDate = po.createdAt?.toDate
    ? format(po.createdAt.toDate(), 'dd MMM yyyy')
    : format(new Date(), 'dd MMM yyyy');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Unified Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 border-b border-slate-800 bg-slate-950/90 shrink-0">
          <div className="flex items-center gap-2.5 text-indigo-400">
            <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-100 flex items-center gap-2">
                Purchase Order Bill <span className="font-mono text-indigo-400 font-bold">#{po.poNumber}</span>
              </h3>
              <p className="text-[10px] text-slate-400 font-medium">
                {po.status === 'fulfilled' ? '✓ Invoiced & Fulfilled' : '• Open Purchase Order'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {po.status !== 'fulfilled' && onUseInBillEntry && (
              <button
                type="button"
                onClick={onUseInBillEntry}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2.5 px-3.5 rounded-xl shadow cursor-pointer transition-all active:scale-95"
              >
                <ArrowRight size={14} /> Log as Bill
              </button>
            )}
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
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <X size={16} />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Printable Paper Document (Scrollable Area) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-950/40 flex justify-center">
          <div id="printable-po" className="w-full max-w-3xl p-6 sm:p-10 bg-white text-slate-900 space-y-6 rounded-2xl shadow-xl border border-slate-200">
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
              <span className="inline-block bg-indigo-700 text-white text-[11px] font-black px-3 py-1 rounded uppercase tracking-wider mb-1">
                Purchase Order
              </span>
              <p className="text-xs font-mono font-bold text-slate-700">PO #: {po.poNumber}</p>
              <p className="text-[11px] text-slate-500">Date: {createdDate}</p>
              {po.expectedDate && (
                <p className="text-[11px] text-slate-500">Expected: {po.expectedDate}</p>
              )}
            </div>
          </div>

          {/* Supplier Info */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Vendor / Supplier</p>
              <p className="font-bold text-sm text-slate-900 mt-0.5">{po.supplierName}</p>
              {po.supplierPhone && <p className="text-slate-600">Phone: {po.supplierPhone}</p>}
              {po.supplierAddress && <p className="text-slate-600">Address: {po.supplierAddress}</p>}
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Order Status</p>
              <p className="font-bold uppercase text-xs mt-0.5 text-indigo-700">
                {po.status === 'fulfilled' ? '✓ Invoiced & Fulfilled' : '• Open Purchase Order'}
              </p>
              <p className="text-[10px] text-slate-500 mt-2">
                All products contain scannable barcodes for direct barcode scanner verification.
              </p>
            </div>
          </div>

          {/* Items Table with Real-Time Barcodes */}
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-wider text-slate-700">Ordered Products</p>
            <div className="border border-slate-200 rounded-xl overflow-x-auto overflow-y-hidden scrollbar-thin">
              <table className="w-full min-w-[620px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider">
                    <th className="py-2.5 px-3">#</th>
                    <th className="py-2.5 px-3">Product Name</th>
                    <th className="py-2.5 px-3 text-center">Barcode (Scannable)</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Unit Cost ({currency})</th>
                    <th className="py-2.5 px-3 text-right">Total ({currency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {po.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-3 px-3 text-slate-400">{idx + 1}</td>
                      <td className="py-3 px-3">
                        <p className="font-bold text-slate-900">{item.name}</p>
                        {item.category && (
                          <span className="text-[10px] text-slate-500">{item.category}</span>
                        )}
                        {item.productCode && (
                          <span className="block text-[10px] font-mono text-slate-400">
                            Code: {item.productCode}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {item.barcode ? (
                          <div className="flex justify-center">
                            <Barcode value={item.barcode} height={32} width={1.2} fontSize={9} />
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[10px]">No Barcode</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        {item.orderMode === 'pack' && item.packCount ? (
                          <div className="flex flex-col items-end">
                            <span className="font-black text-xs text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                              📦 {item.packCount} Packs ({item.piecesPerPack || 24} pcs/pk)
                            </span>
                            <span className="text-[10px] font-mono text-slate-600 mt-0.5">
                              = {item.quantity} pcs total
                            </span>
                          </div>
                        ) : (
                          <span className="font-black text-sm">{item.quantity} {item.unit || 'pcs'}</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-medium font-mono">
                        {item.orderMode === 'pack' && item.packPrice ? (
                          <div className="flex flex-col items-end">
                            <span className="font-bold text-xs text-slate-900">
                              {formatAmount(item.packPrice, currency)} /pack
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ({formatAmount(item.unitPrice, currency)}/pc)
                            </span>
                          </div>
                        ) : (
                          formatAmount(item.unitPrice, currency)
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-black font-mono text-sm">
                        {formatAmount(item.totalPrice || item.quantity * item.unitPrice, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Grand Total */}
          <div className="border-t-2 border-slate-900 pt-4 flex justify-between items-start">
            <div className="text-xs text-slate-600 max-w-sm">
              {po.notes && (
                <>
                  <p className="font-bold text-slate-900">Notes / Instructions:</p>
                  <p className="italic text-slate-500 mt-0.5">{po.notes}</p>
                </>
              )}
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider block">
                Total Purchase Order Value
              </span>
              <span className="text-2xl font-black font-mono text-indigo-700">
                {currency} {formatAmount(po.totalAmount || 0, currency)}
              </span>
            </div>
          </div>

          {/* Signature & Confirmation Footer */}
          <div className="pt-10 border-t border-slate-200 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
            <div className="border-t border-slate-300 pt-2 mt-8">
              <p className="font-bold text-slate-700">Prepared By (Purchaser)</p>
              <p className="text-[10px] text-slate-400">Signature & Date</p>
            </div>
            <div className="border-t border-slate-300 pt-2 mt-8">
              <p className="font-bold text-slate-700">Supplier Acceptance</p>
              <p className="text-[10px] text-slate-400">Stamp & Authorized Signature</p>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
