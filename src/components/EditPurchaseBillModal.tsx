import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Save,
  Package,
  Trash2,
  DollarSign,
  Calendar,
  Building,
  RefreshCw,
  Plus,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Layers,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Barcode as BarcodeIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '@/src/lib/firebase';
import { format } from 'date-fns';
import {
  PurchaseLog,
  PurchaseOrderItem,
  Supplier,
  Branch,
  SalesPlayProduct,
  BankAccount,
} from '@/src/types';
import { ProductSearchAndScan } from './ProductSearchAndScan';
import { formatAmount, isWeightItem, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import {
  buildItemFromProduct,
  buildCustomItemWithBarcode,
} from '@/src/services/productPackService';
import {
  updateSalesPlayInventory,
  getSalesPlaySettings,
  DEFAULT_SALESPLAY_CONFIG,
} from '@/src/services/salesplay';
import { cn } from '@/src/lib/utils';

interface EditPurchaseBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  log: PurchaseLog | null;
  currency: string;
  suppliers: Supplier[];
  branches: Branch[];
  salesPlayProducts: SalesPlayProduct[];
  bankAccounts?: BankAccount[];
  activeBusinessId?: string;
  onSaved: () => void;
  onSyncSalesPlay?: () => Promise<void>;
  isSyncingSalesPlay?: boolean;
}

export function EditPurchaseBillModal({
  isOpen,
  onClose,
  log,
  currency,
  suppliers,
  branches,
  salesPlayProducts,
  bankAccounts = [],
  activeBusinessId,
  onSaved,
  onSyncSalesPlay,
  isSyncingSalesPlay = false,
}: EditPurchaseBillModalProps) {
  if (!isOpen || !log) return null;

  // Form State
  const [invoiceNumber, setInvoiceNumber] = useState(log.invoiceNumber || '');
  const [supplierId, setSupplierId] = useState(log.supplierId || '');
  const [branchId, setBranchId] = useState(log.branchId || '');
  const [billDate, setBillDate] = useState(
    log.date ? format(new Date(log.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
  );
  const [paymentMode, setPaymentMode] = useState<string>(log.paymentMode || 'due');
  const [bankAccountId, setBankAccountId] = useState(log.bankAccountId || '');
  const [paidAmount, setPaidAmount] = useState<number>(Number(log.paidAmount) || 0);
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Initialize items from the bill log
  useEffect(() => {
    if (log && Array.isArray(log.items)) {
      setItems(log.items.map(i => ({ ...i })));
    } else {
      setItems([]);
    }
    setInvoiceNumber(log.invoiceNumber || '');
    setSupplierId(log.supplierId || '');
    setBranchId(log.branchId || '');
    setPaymentMode(log.paymentMode || 'due');
    setBankAccountId(log.bankAccountId || '');
    setPaidAmount(Number(log.paidAmount) || 0);
    setBillDate(log.date ? format(new Date(log.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
  }, [log]);

  // Original items map for delta calculations
  const originalItemsMap = useMemo(() => {
    const map = new Map<string, number>();
    if (log && Array.isArray(log.items)) {
      log.items.forEach(i => {
        const key = (i.productId && i.productId.length > 5 && !i.productId.startsWith('item_'))
          ? i.productId
          : (i.barcode || i.name || i.id).trim().toLowerCase();
        map.set(key, (map.get(key) || 0) + (Number(i.quantity) || 0));
      });
    }
    return map;
  }, [log]);

  // Resolve SalesPlay product ID helper
  const resolveSalesPlayId = (item: PurchaseOrderItem): string | null => {
    if (item.productId && item.productId.length > 10 && !item.productId.startsWith('item_') && !item.productId.startsWith('sp_')) {
      return item.productId;
    }
    const found = salesPlayProducts.find(p =>
      (item.barcode && p.barcode && p.barcode.trim() === item.barcode.trim()) ||
      (item.productCode && p.product_code && p.product_code.trim() === item.productCode.trim()) ||
      (item.name && p.product_name && p.product_name.trim().toLowerCase() === item.name.trim().toLowerCase())
    );
    return found?.id || null;
  };

  // Add item from SalesPlay Product selection
  const handleSelectProduct = (product: SalesPlayProduct) => {
    const existingIndex = items.findIndex(
      (item) => (product.id && item.productId === product.id) || (product.barcode && item.barcode === product.barcode)
    );

    const isWeight = isWeightItem(product.product_name, product.measurement);

    if (existingIndex >= 0) {
      const updated = [...items];
      const item = updated[existingIndex];
      if (item.orderMode === 'pack') {
        const newPackCount = (Number(item.packCount) || 1) + 1;
        const pPerPack = Number(item.piecesPerPack) || 24;
        item.packCount = newPackCount;
        item.quantity = Math.round(newPackCount * pPerPack * 1000) / 1000;
        item.totalPrice = toStrictDecimal3(newPackCount * (Number(item.packPrice) || 0));
        toast.success(`Incremented "${product.product_name}" to ${newPackCount} Packs (= ${item.quantity} pcs)`);
      } else {
        const incrementVal = isWeight ? 1.000 : 1;
        item.quantity = toStrictDecimal3(Number(item.quantity || 0) + incrementVal);
        item.totalPrice = toStrictDecimal3(item.quantity * item.unitPrice);
        toast.success(`Incremented quantity for "${product.product_name}"`);
      }
      setItems(updated);
    } else {
      const unitCost = Number(product.last_purchase_cost ?? product.cost ?? 0);
      const newItem = buildItemFromProduct(product, activeBusinessId || 'default', unitCost);
      setItems([...items, newItem]);
      toast.success(`Added "${product.product_name}" to bill`);
    }
  };

  // Add custom unlisted item with scanned barcode
  const handleAddCustomWithBarcode = (barcode: string) => {
    const newItem = buildCustomItemWithBarcode(barcode, activeBusinessId || 'default');
    setItems([...items, newItem]);
    toast.info(`Added item with barcode "${barcode}". Enter product name and cost.`);
  };

  // Update item pack/quantity fields
  const handleItemFieldChange = (index: number, field: keyof PurchaseOrderItem, value: any) => {
    const updated = [...items];
    const item = { ...updated[index], [field]: value };

    if (item.orderMode === 'pack') {
      const pCount = Number(field === 'packCount' ? value : item.packCount) || 0;
      const pPieces = Number(field === 'piecesPerPack' ? value : item.piecesPerPack) || 24;
      const pPrice = Number(field === 'packPrice' ? value : item.packPrice) || 0;

      item.quantity = Math.round(pCount * pPieces * 1000) / 1000;
      item.totalPrice = toStrictDecimal3(pCount * pPrice);
      item.unitPrice = pPieces > 0 ? toStrictDecimal3(pPrice / pPieces) : 0;
    } else {
      const qty = Number(field === 'quantity' ? value : item.quantity) || 0;
      const uPrice = Number(field === 'unitPrice' ? value : item.unitPrice) || 0;
      item.totalPrice = toStrictDecimal3(qty * uPrice);
    }

    updated[index] = item;
    setItems(updated);
  };

  // Toggle between Pack mode and Direct Pcs/Kg mode
  const handleToggleItemMode = (index: number, newMode: 'pack' | 'pcs') => {
    const updated = [...items];
    const item = { ...updated[index] };
    item.orderMode = newMode;

    if (newMode === 'pack') {
      const pPieces = Number(item.piecesPerPack) || 24;
      const pCount = Number(item.packCount) || 1;
      item.piecesPerPack = pPieces;
      item.packCount = pCount;
      item.quantity = Math.round(pCount * pPieces * 1000) / 1000;
      if (!item.packPrice) {
        item.packPrice = toStrictDecimal3((Number(item.unitPrice) || 0) * pPieces);
      }
      item.totalPrice = toStrictDecimal3(pCount * (Number(item.packPrice) || 0));
    } else {
      item.quantity = Number(item.quantity) || 1;
      item.totalPrice = toStrictDecimal3((Number(item.quantity) || 1) * (Number(item.unitPrice) || 0));
    }

    updated[index] = item;
    setItems(updated);
  };

  // Remove item
  const handleRemoveItem = (index: number) => {
    const updated = [...items];
    const removed = updated.splice(index, 1)[0];
    setItems(updated);
    toast.info(`Removed "${removed.name}" from bill`);
  };

  // Totals
  const calculatedBillAmount = useMemo(() => {
    return items.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0);
  }, [items]);

  const oldBillAmount = Number(log.billAmount) || Number((log as any).amount) || 0;
  const oldPaidAmount = Number(log.paidAmount) || 0;
  const calculatedNetDue = Math.max(0, calculatedBillAmount - paidAmount);

  // Calculate stock deltas for each item for live visual preview
  const itemStockImpacts = useMemo(() => {
    return items.map((item) => {
      const spId = resolveSalesPlayId(item);
      const key = spId || (item.barcode || item.name || item.id).trim().toLowerCase();
      const oldQty = originalItemsMap.get(key) || 0;
      const newQty = Number(item.quantity) || 0;
      const delta = Math.round((newQty - oldQty) * 1000) / 1000;

      return {
        spId,
        oldQty,
        newQty,
        delta,
        isSalesPlay: !!spId,
      };
    });
  }, [items, originalItemsMap, salesPlayProducts]);

  // Deleted items stock rollback impact
  const removedItemsImpact = useMemo(() => {
    const currentKeys = new Set(
      items.map(i => {
        const spId = resolveSalesPlayId(i);
        return spId || (i.barcode || i.name || i.id).trim().toLowerCase();
      })
    );

    const removed: { name: string; spId: string | null; returnQty: number }[] = [];
    if (log && Array.isArray(log.items)) {
      log.items.forEach(oldItem => {
        const spId = resolveSalesPlayId(oldItem);
        const key = spId || (oldItem.barcode || oldItem.name || oldItem.id).trim().toLowerCase();
        if (!currentKeys.has(key)) {
          removed.push({
            name: oldItem.name,
            spId,
            returnQty: Number(oldItem.quantity) || 0,
          });
        }
      });
    }
    return removed;
  }, [items, log, salesPlayProducts]);

  // Handle Save Edited Bill
  const handleSaveBill = async () => {
    if (!supplierId) {
      toast.error('Please select a supplier');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one item to the bill');
      return;
    }

    setSaving(true);
    const saveToast = toast.loading('Updating purchase bill and synchronizing SalesPlay stock...');

    try {
      const selectedSup = suppliers.find(s => s.id === supplierId);
      const finalInvoiceNumber = invoiceNumber.trim() || log.invoiceNumber;
      const finalBillAmount = calculatedBillAmount;
      const finalPaidAmount = Number(paidAmount) || 0;
      const finalNetDue = Math.max(0, finalBillAmount - finalPaidAmount);

      // 1. Prepare SalesPlay Stock Deltas
      const stockUpdates: { productId: string; quantityDelta: number }[] = [];

      // A. Deltas from current items
      itemStockImpacts.forEach((impact) => {
        if (impact.spId && impact.delta !== 0) {
          stockUpdates.push({
            productId: impact.spId,
            quantityDelta: impact.delta,
          });
        }
      });

      // B. Rollbacks from removed items
      removedItemsImpact.forEach((rem) => {
        if (rem.spId && rem.returnQty > 0) {
          stockUpdates.push({
            productId: rem.spId,
            quantityDelta: -rem.returnQty, // reduce/return stock from SalesPlay
          });
        }
      });

      // 2. Perform live SalesPlay Stock Update if there are any deltas
      let spSyncSuccess = false;
      let spUpdatedCount = 0;
      if (stockUpdates.length > 0 && activeBusinessId) {
        try {
          const spSettings = await getSalesPlaySettings(activeBusinessId);
          const mappedShop = (spSettings.branchShopMap && spSettings.branchShopMap[branchId])
            || spSettings.selectedShopId
            || DEFAULT_SALESPLAY_CONFIG.defaultShopId;

          const spRes = await updateSalesPlayInventory(mappedShop, stockUpdates, spSettings.apiToken);
          spSyncSuccess = spRes.success;
          spUpdatedCount = spRes.updatedCount;
        } catch (spErr) {
          console.warn('SalesPlay edit sync notice:', spErr);
        }
      }

      // 3. Update purchaseLogs Document in Firestore
      const logRef = doc(db, 'purchaseLogs', log.id);
      await updateDoc(logRef, {
        invoiceNumber: finalInvoiceNumber,
        supplierId,
        supplierName: selectedSup?.name || log.supplierName || 'Supplier',
        branchId: branchId || 'main',
        date: new Date(billDate).toISOString(),
        billAmount: finalBillAmount,
        paidAmount: finalPaidAmount,
        amount: finalBillAmount,
        netDue: finalNetDue,
        paymentMode,
        bankAccountId: bankAccountId || '',
        items: items.map(i => ({
          id: i.id,
          productId: i.productId || '',
          productCode: i.productCode || '',
          name: i.name.trim() || 'Item',
          barcode: (i.barcode || '').trim(),
          category: i.category || '',
          unit: i.unit || 'pcs',
          orderMode: i.orderMode || (i.unit === 'kg' ? 'pcs' : 'pack'),
          packCount: i.packCount,
          piecesPerPack: i.piecesPerPack,
          packPrice: i.packPrice,
          quantity: Number(i.quantity) || 1,
          unitPrice: Number(i.unitPrice) || 0,
          salesPrice: Number(i.salesPrice) || 0,
          totalPrice: Number(i.totalPrice) || 0,
        })),
        updatedAt: serverTimestamp(),
        syncedToSalesPlay: spSyncSuccess || log.syncedToSalesPlay || false,
        salesPlayUpdatedCount: spUpdatedCount || (log as any).salesPlayUpdatedCount || 0,
      });

      // 4. Update Supplier Total Due Balance
      const oldDueImpact = oldBillAmount - oldPaidAmount;
      const newDueImpact = finalBillAmount - finalPaidAmount;
      const dueDelta = newDueImpact - oldDueImpact;

      if (dueDelta !== 0 && supplierId) {
        try {
          await updateDoc(doc(db, 'suppliers', supplierId), {
            totalDue: increment(dueDelta),
          });
        } catch (supErr) {
          console.warn('Failed to update supplier due:', supErr);
        }
      }

      // 5. Update Bank Account if paidAmount changed and was bank
      const paidDelta = finalPaidAmount - oldPaidAmount;
      if (paidDelta !== 0 && (paymentMode === 'bank' || paymentMode === 'card') && bankAccountId) {
        try {
          await updateDoc(doc(db, 'bankAccounts', bankAccountId), {
            balance: increment(-paidDelta),
          });
        } catch (bankErr) {
          console.warn('Failed to adjust bank account balance:', bankErr);
        }
      }

      toast.dismiss(saveToast);
      toast.success(
        `Purchase bill #${finalInvoiceNumber} updated successfully!${
          stockUpdates.length > 0 ? ` (${stockUpdates.length} stock items updated in SalesPlay)` : ''
        }`
      );

      onSaved();
      onClose();
    } catch (err: any) {
      toast.dismiss(saveToast);
      console.error('Failed to update purchase bill:', err);
      toast.error(`Failed to update bill: ${err?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-[#1E293B] border border-slate-700/80 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Package size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-100 flex items-center gap-2">
                <span>Edit Purchase Bill</span>
                <span className="text-amber-400 font-mono text-xs sm:text-sm">#{invoiceNumber || log.invoiceNumber}</span>
              </h2>
              <p className="text-xs text-slate-400">
                Modify quantities, pack sizes, items, and auto-sync stock changes with SalesPlay POS
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* 1. Header Information (Invoice, Supplier, Branch, Date, Payment) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-slate-900/60 rounded-2xl border border-slate-800">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Invoice Number
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full bg-slate-800 text-slate-200 text-xs font-mono font-bold px-3 py-2.5 rounded-xl border border-slate-700 outline-none focus:border-amber-400"
                placeholder="INV-001"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Supplier
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-700 outline-none focus:border-amber-400"
              >
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Branch
              </label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="w-full bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-700 outline-none focus:border-amber-400"
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Bill Date
              </label>
              <input
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl border border-slate-700 outline-none focus:border-amber-400"
              />
            </div>
          </div>

          {/* 2. Product Search & Barcode Scanner for adding items */}
          <div className="space-y-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Plus size={14} className="text-indigo-400" />
              Add More Products to this Bill
            </h3>
            <ProductSearchAndScan
              products={salesPlayProducts}
              onSelectProduct={handleSelectProduct}
              onAddCustomWithBarcode={handleAddCustomWithBarcode}
              currency={currency}
              autoFocusScanner={false}
              onSyncSalesPlay={onSyncSalesPlay}
              isSyncing={isSyncingSalesPlay}
            />
          </div>

          {/* 3. Items List with Pack & Qty Controls */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Package size={14} className="text-amber-400" />
                Purchased Items ({items.length})
              </h3>
              <span className="text-[11px] text-slate-400 font-medium">
                Change quantity or pack size to update bill total and SalesPlay inventory stock
              </span>
            </div>

            {items.length === 0 ? (
              <div className="p-8 text-center bg-slate-900/40 rounded-2xl border border-slate-800 text-slate-500 text-xs">
                No items in this bill. Scan barcode or search above to add items.
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item, idx) => {
                  const impact = itemStockImpacts[idx];
                  const isWeight = item.unit === 'kg' || isWeightItem(item.name, item.measurement);
                  const isPack = item.orderMode === 'pack';

                  return (
                    <div
                      key={item.id || idx}
                      className="p-4 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-100">{item.name}</span>
                            {item.barcode && (
                              <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-md border border-slate-700">
                                {item.barcode}
                              </span>
                            )}
                            {item.category && (
                              <span className="text-[10px] bg-slate-800/80 text-blue-400 px-2 py-0.5 rounded-md">
                                {item.category}
                              </span>
                            )}
                          </div>
                          {item.productCode && (
                            <p className="text-[10px] font-mono text-slate-500 mt-0.5">Code: {item.productCode}</p>
                          )}
                        </div>

                        {/* Live SalesPlay Stock Impact Badge */}
                        <div className="flex items-center gap-2 shrink-0">
                          {impact?.isSalesPlay ? (
                            impact.delta > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 px-2.5 py-1 rounded-lg">
                                <TrendingUp size={12} />
                                SalesPlay: +{impact.delta} pcs (Gain)
                              </span>
                            ) : impact.delta < 0 ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-rose-950/80 text-rose-400 border border-rose-800/80 px-2.5 py-1 rounded-lg">
                                <TrendingDown size={12} />
                                SalesPlay: {impact.delta} pcs (Return)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-slate-800 text-slate-400 px-2.5 py-1 rounded-lg">
                                SalesPlay Stock: Unchanged
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] font-bold bg-slate-800/70 text-slate-500 px-2 py-0.5 rounded-lg">
                              Custom Item
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                            title="Remove item from bill"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Controls: Mode Switcher & Inputs */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-2 border-t border-slate-800/70 items-center">
                        {/* Mode Selector */}
                        <div className="sm:col-span-3 flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                          <button
                            type="button"
                            onClick={() => handleToggleItemMode(idx, 'pack')}
                            className={cn(
                              'flex-1 text-[10px] font-bold py-1 px-2 rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer',
                              isPack ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                            )}
                          >
                            <Layers size={11} />
                            Pack Mode
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleItemMode(idx, 'pcs')}
                            className={cn(
                              'flex-1 text-[10px] font-bold py-1 px-2 rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer',
                              !isPack ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                            )}
                          >
                            {isWeight ? 'Kg Mode' : 'Pcs Mode'}
                          </button>
                        </div>

                        {/* Mode-specific Fields */}
                        {isPack ? (
                          <>
                            <div className="sm:col-span-2">
                              <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                Packs
                              </label>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={item.packCount || 1}
                                onChange={(e) => handleItemFieldChange(idx, 'packCount', e.target.value)}
                                className="w-full bg-slate-950 text-slate-100 text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-700 outline-none focus:border-amber-400"
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                Pcs / Pack
                              </label>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={item.piecesPerPack || 24}
                                onChange={(e) => handleItemFieldChange(idx, 'piecesPerPack', e.target.value)}
                                className="w-full bg-slate-950 text-slate-100 text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-700 outline-none focus:border-amber-400"
                              />
                            </div>

                            <div className="sm:col-span-3">
                              <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                Pack Price ({currency})
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={item.packPrice || 0}
                                onChange={(e) => handleItemFieldChange(idx, 'packPrice', e.target.value)}
                                className="w-full bg-slate-950 text-amber-400 font-mono text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-700 outline-none focus:border-amber-400"
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="sm:col-span-4">
                              <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                Quantity ({item.unit || (isWeight ? 'kg' : 'pcs')})
                              </label>
                              <input
                                type="number"
                                min="0.001"
                                step={isWeight ? '0.001' : '1'}
                                value={item.quantity || 1}
                                onChange={(e) => handleItemFieldChange(idx, 'quantity', e.target.value)}
                                className="w-full bg-slate-950 text-slate-100 text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-700 outline-none focus:border-blue-400"
                              />
                            </div>

                            <div className="sm:col-span-3">
                              <label className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                                Unit Cost ({currency})
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={item.unitPrice || 0}
                                onChange={(e) => handleItemFieldChange(idx, 'unitPrice', e.target.value)}
                                className="w-full bg-slate-950 text-blue-400 font-mono text-xs font-bold px-2 py-1.5 rounded-lg border border-slate-700 outline-none focus:border-blue-400"
                              />
                            </div>
                          </>
                        )}

                        {/* Total Price Display */}
                        <div className="sm:col-span-2 text-right">
                          <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                            Line Total
                          </span>
                          <span className="text-xs font-mono font-black text-slate-200">
                            {currency} {formatAmount(item.totalPrice || 0, currency)}
                          </span>
                          {isPack && (
                            <span className="block text-[9px] text-slate-500">
                              (= {item.quantity} pcs)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. Removed Items Notice if any */}
          {removedItemsImpact.length > 0 && (
            <div className="p-4 bg-rose-950/20 border border-rose-900/40 rounded-2xl space-y-1.5">
              <p className="text-xs font-bold text-rose-300 flex items-center gap-2">
                <AlertCircle size={14} />
                <span>Items removed from this bill ({removedItemsImpact.length}):</span>
              </p>
              <div className="flex flex-wrap gap-2 text-[10px]">
                {removedItemsImpact.map((rem, i) => (
                  <span key={i} className="bg-rose-950/60 text-rose-400 border border-rose-800/60 px-2 py-0.5 rounded-md">
                    {rem.name}: -{rem.returnQty} pcs will be returned from SalesPlay stock
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 5. Payment Details Section */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-900/60 rounded-2xl border border-slate-800">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Payment Mode
              </label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="w-full bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-700 outline-none focus:border-amber-400"
              >
                <option value="due">Full Due / Credit</option>
                <option value="cash">Cash Payment</option>
                <option value="bank">Bank Transfer</option>
                <option value="card">Card Payment</option>
                <option value="online">Online Payment</option>
              </select>
            </div>

            {(paymentMode === 'bank' || paymentMode === 'card' || paymentMode === 'online') && (
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                  Bank Account
                </label>
                <select
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  className="w-full bg-slate-800 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-700 outline-none focus:border-amber-400"
                >
                  <option value="">Select Bank Account</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.bankName} - {b.accountNumber} ({currency} {formatAmount(b.balance, currency)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">
                Paid Amount ({currency})
              </label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={paidAmount}
                onChange={(e) => setPaidAmount(Number(e.target.value) || 0)}
                className="w-full bg-slate-800 text-emerald-400 font-mono text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-700 outline-none focus:border-emerald-400"
              />
            </div>
          </div>
        </div>

        {/* Modal Footer / Summary & Actions */}
        <div className="p-4 sm:p-6 border-t border-slate-800 bg-slate-900/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block font-sans font-bold">Total Bill:</span>
              <span className="text-base font-black text-amber-400">
                {currency} {formatAmount(calculatedBillAmount, currency)}
              </span>
              {calculatedBillAmount !== oldBillAmount && (
                <span className="text-[10px] text-slate-500 block">
                  (was {currency} {formatAmount(oldBillAmount, currency)})
                </span>
              )}
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase block font-sans font-bold">Paid:</span>
              <span className="text-base font-black text-emerald-400">
                {currency} {formatAmount(paidAmount, currency)}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-slate-500 uppercase block font-sans font-bold">Net Due:</span>
              <span className="text-base font-black text-rose-400">
                {currency} {formatAmount(calculatedNetDue, currency)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 sm:flex-none px-5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveBill}
              disabled={saving}
              className="flex-1 sm:flex-none px-6 py-3 rounded-2xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-black shadow-lg shadow-amber-900/30 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
            >
              {saving ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Saving & Syncing...</span>
                </>
              ) : (
                <>
                  <Save size={14} />
                  <span>Save Changes & Sync SalesPlay</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
