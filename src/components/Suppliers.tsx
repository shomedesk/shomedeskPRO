import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '@/src/lib/firebase';
import {
  collection,
  addDoc,
  query,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  doc,
  increment,
  where,
  getDocs
} from 'firebase/firestore';
import {
  Supplier,
  PurchaseLog,
  Branch,
  Business,
  PurchaseOrder,
  PurchaseOrderItem,
  SalesPlayProduct,
  BankAccount,
  SupplierProduct
} from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import {
  Truck,
  History,
  Search,
  UserPlus,
  Save,
  ShoppingCart,
  AlertCircle,
  Building2,
  MapPin,
  FileText,
  Download,
  Store,
  Plus,
  Trash2,
  Barcode as BarcodeIcon,
  CheckCircle2,
  ArrowRight,
  CreditCard,
  Banknote,
  Eye,
  Zap,
  Package,
  Layers,
  Sparkles
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { format } from 'date-fns';
import { formatAmount, isWeightItem, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import { generateBillPdf } from '@/src/lib/pdfUtils';
import { PurchaseOrderManager } from './PurchaseOrderManager';
import { BillReceiptModal } from './BillReceiptModal';
import { PurchaseReportModal } from './PurchaseReportModal';
import { SalesPlaySyncModal } from './SalesPlaySyncModal';
import { Barcode } from './Barcode';
import { ProductSearchAndScan } from './ProductSearchAndScan';
import { SupplierProductProfileModal } from './SupplierProductProfileModal';
import {
  getSupplierProducts,
  saveSupplierProductsFromBill
} from '@/src/services/supplierProductService';
import {
  updateSalesPlayInventory,
  getSalesPlaySettings,
  fetchSalesPlayProductsWithInventory,
  fetchSalesPlayCategories,
  DEFAULT_SALESPLAY_CONFIG,
  FALLBACK_SALESPLAY_PRODUCTS,
  FALLBACK_SALESPLAY_CATEGORIES
} from '@/src/services/salesplay';
import { SalesPlayCategory } from '@/src/types';

export default function Suppliers() {
  const { selectedBusiness, selectedBranch, businesses, branches, isAllBusinessesSelected, userProfile } = useBusiness();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseLogs, setPurchaseLogs] = useState<PurchaseLog[]>([]);
  const [activeTab, setActiveTab] = useState<'entry' | 'po' | 'manage'>('entry');
  const [loading, setLoading] = useState(true);
  const [selectedPOForEntry, setSelectedPOForEntry] = useState<PurchaseOrder | null>(null);
  const [showSalesPlayModal, setShowSalesPlayModal] = useState(false);

  useEffect(() => {
    if (!selectedBusiness && !isAllBusinessesSelected) {
      setSuppliers([]);
      setPurchaseLogs([]);
      setLoading(false);
      return;
    }

    const isBranchManager = userProfile?.role === 'branch_manager';
    let unsubSuppliers: () => void = () => {};
    let unsubLogs: () => void = () => {};

    if (isAllBusinessesSelected) {
      const businessIds = businesses.map(b => b.id);
      if (businessIds.length === 0) {
        setSuppliers([]);
        setPurchaseLogs([]);
        setLoading(false);
        return;
      }

      const qSuppliers = query(
        collection(db, 'suppliers'),
        where('businessId', 'in', businessIds.slice(0, 10))
      );

      const qLogs = query(
        collection(db, 'purchaseLogs'),
        where('businessId', 'in', businessIds.slice(0, 10))
      );

      unsubSuppliers = onSnapshot(qSuppliers, (snapshot) => {
        const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
        loaded.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setSuppliers(loaded);
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'suppliers');
        setLoading(false);
      });

      unsubLogs = onSnapshot(qLogs, (snapshot) => {
        const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseLog));
        loaded.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        setPurchaseLogs(loaded);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'purchaseLogs');
      });
    } else if (selectedBusiness) {
      let qSuppliers = query(
        collection(db, 'suppliers'), 
        where('businessId', '==', selectedBusiness.id)
      );

      if (isBranchManager && selectedBranch) {
        qSuppliers = query(
          collection(db, 'suppliers'), 
          where('businessId', '==', selectedBusiness.id),
          where('branchId', '==', selectedBranch.id)
        );
      }
      
      let qLogs = query(
        collection(db, 'purchaseLogs'), 
        where('businessId', '==', selectedBusiness.id)
      );

      if (selectedBranch) {
        qLogs = query(
          collection(db, 'purchaseLogs'), 
          where('businessId', '==', selectedBusiness.id),
          where('branchId', '==', selectedBranch.id)
        );
      }

      unsubSuppliers = onSnapshot(qSuppliers, (snapshot) => {
        const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier));
        loaded.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setSuppliers(loaded);
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'suppliers');
        setLoading(false);
      });

      unsubLogs = onSnapshot(qLogs, (snapshot) => {
        const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseLog));
        loaded.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        setPurchaseLogs(loaded);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'purchaseLogs');
      });
    }

    return () => {
      unsubSuppliers();
      unsubLogs();
    };
  }, [selectedBusiness, selectedBranch, isAllBusinessesSelected, businesses, userProfile]);

  const currency = selectedBranch?.currency || selectedBusiness?.currency || 'OMR';

  return (
    <div className="space-y-6">
      {/* Tab Navigation + SalesPlay Integration Button */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex-1 flex overflow-x-auto no-scrollbar bg-[#1E293B] p-1 rounded-2xl border border-slate-800 shadow-lg">
          <TabButton
            active={activeTab === 'entry'}
            onClick={() => setActiveTab('entry')}
            label="Bill Entry"
            icon={<ShoppingCart size={16} />}
          />
          <TabButton
            active={activeTab === 'po'}
            onClick={() => setActiveTab('po')}
            label="Purchase Orders"
            icon={<FileText size={16} />}
          />
          <TabButton
            active={activeTab === 'manage'}
            onClick={() => setActiveTab('manage')}
            label="Suppliers Directory"
            icon={<UserPlus size={16} />}
          />
        </div>

        {/* SalesPlay POS Integration Badge / Trigger */}
        <button
          onClick={() => setShowSalesPlayModal(true)}
          className="flex items-center justify-center gap-2 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-400 border border-emerald-800/70 py-2.5 sm:py-3 px-4 rounded-2xl text-[11px] sm:text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-lg active:scale-95 shrink-0"
          title="SalesPlay POS integration, shop mapping and live stock sync"
        >
          <Store size={16} />
          <span>SalesPlay POS</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </button>
      </div>

      {/* Main Tab Panels */}
      {activeTab === 'entry' && (
        <div className="space-y-6">
          {userProfile?.role === 'accountant' ? (
            <div className="bg-[#1E293B] p-8 rounded-3xl border border-slate-800 shadow-xl text-center">
              <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">Read Only Access</p>
            </div>
          ) : (
            <PurchaseEntryForm
              suppliers={suppliers}
              currency={currency}
              importedPO={selectedPOForEntry}
              onClearImportedPO={() => setSelectedPOForEntry(null)}
            />
          )}
          <RecentLogs
            logs={purchaseLogs}
            currency={currency}
            branches={branches}
            businesses={businesses}
            isAllBusinessesSelected={isAllBusinessesSelected}
            suppliers={suppliers}
          />
        </div>
      )}

      {activeTab === 'po' && (
        <PurchaseOrderManager
          suppliers={suppliers}
          branches={branches}
          currency={currency}
          onSelectForBillEntry={(po) => {
            setSelectedPOForEntry(po);
            setActiveTab('entry');
            toast.info(`Imported Purchase Order "${po.poNumber}" into Bill Entry.`);
          }}
        />
      )}

      {activeTab === 'manage' && (
        <div className="space-y-6">
          {userProfile?.role === 'accountant' ? (
            <div className="bg-[#1E293B] p-8 rounded-3xl border border-slate-800 shadow-xl text-center">
              <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">Read Only Access</p>
            </div>
          ) : (
            <AddSupplierForm />
          )}
          <SupplierDirectory
            suppliers={suppliers}
            currency={currency}
            businesses={businesses}
            branches={branches}
            isAllBusinessesSelected={isAllBusinessesSelected}
          />
        </div>
      )}

      {/* SalesPlay Modal */}
      {showSalesPlayModal && (
        <SalesPlaySyncModal
          business={selectedBusiness || businesses[0] || null}
          branches={branches}
          currency={currency}
          onClose={() => setShowSalesPlayModal(false)}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 sm:gap-2 py-2.5 sm:py-3 px-2.5 sm:px-4 rounded-xl font-bold text-[10px] sm:text-[11px] uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap shrink-0 sm:shrink",
        active ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" : "text-slate-400 hover:text-slate-200"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Enhanced Purchase Entry Form
 * Supports optional PO import, item-by-item editing/adding/removing with barcodes,
 * and automatic SalesPlay stock sync upon bill entry!
 */
function PurchaseEntryForm({
  suppliers,
  currency,
  importedPO,
  onClearImportedPO,
}: {
  suppliers: Supplier[];
  currency: string;
  importedPO?: PurchaseOrder | null;
  onClearImportedPO?: () => void;
}) {
  const { selectedBusiness, selectedBranch, businesses, branches, isAllBusinessesSelected, bankAccounts, userProfile } = useBusiness();
  const [selectedBranchId, setSelectedBranchId] = useState<string>(selectedBranch?.id || '');
  const [availablePOs, setAvailablePOs] = useState<PurchaseOrder[]>([]);
  const [selectedPOId, setSelectedPOId] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'bank' | 'card' | 'online' | 'due'>('cash');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
  const [managerBankAccounts, setManagerBankAccounts] = useState<BankAccount[]>([]);

  const getNextInvoiceNumber = () => {
    const dateStr = format(new Date(), 'yyMMdd');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `BILL-${dateStr}-${rand}`;
  };

  const [formData, setFormData] = useState({
    supplierId: '',
    invoiceNumber: getNextInvoiceNumber(),
    billAmount: 0,
    paidAmount: 0,
  });

  // Purchased items (can be loaded from PO or manually added)
  const [billItems, setBillItems] = useState<PurchaseOrderItem[]>([]);
  const [salesPlayProducts, setSalesPlayProducts] = useState<SalesPlayProduct[]>(FALLBACK_SALESPLAY_PRODUCTS);
  const [loading, setLoading] = useState(false);

  // Supplier Products Profile State
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([]);
  const [loadingSupplierProducts, setLoadingSupplierProducts] = useState(false);
  const [viewingProfileSupplier, setViewingProfileSupplier] = useState<Supplier | null>(null);

  const activeBusiness = selectedBusiness || (businesses.length > 0 ? businesses[0] : null);
  const targetBusinessId = activeBusiness?.id || userProfile?.businessId;
  const relevantBranches = branches.filter(b => !activeBusiness || b.businessId === activeBusiness.id);

  // Combined Catalog (SalesPlay products + any Supplier products with barcodes)
  const combinedCatalogProducts = useMemo(() => {
    const list: SalesPlayProduct[] = [...salesPlayProducts];
    const seenIds = new Set(list.map(p => p.id));
    const seenCodes = new Set(list.map(p => (p.barcode || p.product_code || '').trim().toLowerCase()).filter(Boolean));

    supplierProducts.forEach(sp => {
      const codeKey = (sp.barcode || sp.productCode || '').trim().toLowerCase();
      if (!seenIds.has(sp.productId || sp.id) && (!codeKey || !seenCodes.has(codeKey))) {
        list.push({
          id: sp.productId || sp.id || `sp_${Date.now()}_${Math.random()}`,
          product_name: sp.productName,
          product_code: sp.productCode || '',
          barcode: sp.barcode || '',
          category: sp.category || 'General',
          price: sp.salesPrice || sp.lastCost || 0,
          cost: sp.lastCost || 0,
          last_purchase_cost: sp.lastCost || 0,
          in_stock: 0,
          measurement: sp.unit || 'pcs',
        });
      }
    });
    return list;
  }, [salesPlayProducts, supplierProducts]);

  // Directly fetch bank accounts for Manager to guarantee bank accounts dropdown is available
  useEffect(() => {
    async function loadBanksForUser() {
      if (!targetBusinessId) return;
      try {
        const q = query(collection(db, "bankAccounts"), where("businessId", "==", targetBusinessId));
        const snap = await getDocs(q);
        const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
        if (fetched.length > 0) {
          setManagerBankAccounts(fetched);
        }
      } catch (err) {
        console.warn('Silent notice fetching bank accounts for bill entry:', err);
      }
    }
    loadBanksForUser();
  }, [targetBusinessId]);

  const effectiveBankAccounts = managerBankAccounts.length > 0 ? managerBankAccounts : bankAccounts;

  // Auto-select first bank account when switching to a bank mode
  useEffect(() => {
    if ((paymentMode === 'bank' || paymentMode === 'card' || paymentMode === 'online') && !selectedBankAccountId && effectiveBankAccounts.length > 0) {
      setSelectedBankAccountId(effectiveBankAccounts[0].id);
    }
  }, [paymentMode, effectiveBankAccounts, selectedBankAccountId]);

  const [salesPlayCategories, setSalesPlayCategories] = useState<SalesPlayCategory[]>(FALLBACK_SALESPLAY_CATEGORIES);

  // Load SalesPlay Products and Categories for quick search and scan
  useEffect(() => {
    async function loadProductsAndCategories() {
      try {
        const [prods, cats] = await Promise.all([
          fetchSalesPlayProductsWithInventory(undefined, undefined, true),
          fetchSalesPlayCategories(undefined, true),
        ]);
        if (prods && prods.length > 0) {
          setSalesPlayProducts(prods);
        }
        if (cats && cats.length > 0) {
          setSalesPlayCategories(cats);
        }
      } catch (err) {
        console.warn('Silent fallback on SalesPlay products:', err);
      }
    }
    loadProductsAndCategories();
  }, []);

  // Sync Branch
  useEffect(() => {
    if (selectedBranch?.id) {
      setSelectedBranchId(selectedBranch.id);
    } else if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [selectedBranch, branches]);

  // Fetch open Purchase Orders for this business so user can pick from dropdown
  useEffect(() => {
    if (!activeBusiness) return;
    const q = query(
      collection(db, 'purchaseOrders'),
      where('businessId', '==', activeBusiness.id)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseOrder));
      setAvailablePOs(list.filter(p => p.status !== 'fulfilled'));
    }, (err) => {
      console.warn('PO fetch err:', err);
    });
    return () => unsub();
  }, [activeBusiness]);

  // If an importedPO was passed via props, apply it
  useEffect(() => {
    if (importedPO) {
      setSelectedPOId(importedPO.id || '');
      setSelectedBranchId(importedPO.branchId || selectedBranchId);
      setFormData(prev => ({
        ...prev,
        supplierId: importedPO.supplierId,
        invoiceNumber: importedPO.poNumber || prev.invoiceNumber,
        billAmount: importedPO.totalAmount || 0,
      }));
      setBillItems(importedPO.items ? [...importedPO.items] : []);
    }
  }, [importedPO]);

  // When user selects a PO from the dropdown
  const handleSelectPOFromDropdown = (poId: string) => {
    setSelectedPOId(poId);
    if (!poId) {
      setBillItems([]);
      return;
    }
    const found = availablePOs.find(p => p.id === poId);
    if (found) {
      if (found.branchId) setSelectedBranchId(found.branchId);
      setFormData(prev => ({
        ...prev,
        supplierId: found.supplierId,
        invoiceNumber: found.poNumber,
        billAmount: found.totalAmount,
      }));
      setBillItems(found.items ? [...found.items] : []);
    }
  };

  // Load Supplier's Product Profile whenever a supplier is selected
  useEffect(() => {
    if (!formData.supplierId) {
      setSupplierProducts([]);
      return;
    }
    let isMounted = true;
    setLoadingSupplierProducts(true);
    getSupplierProducts(formData.supplierId, activeBusiness?.id, true)
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
  }, [formData.supplierId, activeBusiness?.id]);

  // Import all products from this supplier's profile catalog into the current bill
  const handleImportAllSupplierProducts = () => {
    if (supplierProducts.length === 0) {
      toast.info('No products found in this supplier catalog yet.');
      return;
    }

    const newItems: PurchaseOrderItem[] = supplierProducts.map((sp, idx) => {
      const isWeight = sp.unit === 'kg' || isWeightItem(sp.productName);
      const defaultQty = isWeight ? 1.000 : 1;
      const unitCost = Number(sp.lastCost) || 0;
      return {
        id: `item_${Date.now()}_${idx}`,
        productId: sp.productId || '',
        productCode: sp.productCode || '',
        name: sp.productName,
        barcode: sp.barcode || '',
        category: sp.category || 'General',
        unit: (sp.unit as any) || (isWeight ? 'kg' : 'pcs'),
        quantity: defaultQty,
        unitPrice: unitCost,
        salesPrice: Number(sp.salesPrice) || 0,
        totalPrice: Math.round(defaultQty * unitCost * 1000) / 1000,
      };
    });

    setBillItems(newItems);
    recalcTotal(newItems);
    toast.success(
      `Imported all ${newItems.length} products from ${selectedSupplier?.name || 'supplier'}'s catalog! Adjust qty, new cost, or delete items as needed.`
    );
  };

  // Add / Edit / Remove Items inside Bill Entry
  const handleAddBillItem = () => {
    const newItem: PurchaseOrderItem = {
      id: `item_${Date.now()}`,
      name: '',
      barcode: `${Math.floor(100000000000 + Math.random() * 900000000000)}`,
      unit: 'pcs',
      quantity: 1,
      unitPrice: 0,
      totalPrice: 0,
    };
    const updated = [...billItems, newItem];
    setBillItems(updated);
    recalcTotal(updated);
  };

  const handleUpdateBillItem = (index: number, field: keyof PurchaseOrderItem, value: any) => {
    const updated = [...billItems];
    const current = { ...updated[index], [field]: value };
    if (field === 'quantity' || field === 'unitPrice') {
      const q = Number(current.quantity) || 0;
      const p = Number(current.unitPrice) || 0;
      current.totalPrice = Math.round(q * p * 1000) / 1000;
    }
    updated[index] = current;
    setBillItems(updated);
    recalcTotal(updated);
  };

  const handleRemoveBillItem = (index: number) => {
    const updated = billItems.filter((_, i) => i !== index);
    setBillItems(updated);
    recalcTotal(updated);
  };

  const recalcTotal = (itemsList: PurchaseOrderItem[]) => {
    if (itemsList.length > 0) {
      const sum = itemsList.reduce((acc, i) => acc + (Number(i.totalPrice) || 0), 0);
      setFormData(prev => ({ ...prev, billAmount: Math.round(sum * 1000) / 1000 }));
    }
  };

  const selectedSupplier = suppliers.find(s => s.id === formData.supplierId);
  const oldDue = selectedSupplier?.totalDue || 0;
  const netDue = oldDue + formData.billAmount - formData.paidAmount;

  const handleSubmit = async (e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!activeBusiness) {
      toast.error('Please select or create a business first');
      return;
    }
    if (!selectedBranchId && relevantBranches.length > 0) {
      toast.error('Please select a branch for this purchase log');
      return;
    }
    if (!formData.supplierId) {
      toast.error('Please select a Supplier / Party (দয়া করে একজন সাপ্লায়ার / পার্টি সিলেক্ট করুন)');
      return;
    }
    const finalInvoiceNumber = formData.invoiceNumber.trim() || getNextInvoiceNumber();

    if ((paymentMode === 'bank' || paymentMode === 'card' || paymentMode === 'online') && formData.paidAmount > 0 && !selectedBankAccountId) {
      toast.error('Please select a Bank Account for this bank/card payment');
      return;
    }

    setLoading(true);
    try {
      // 1. Prepare Purchase Log Payload
      const logPayload: Record<string, any> = {
        businessId: activeBusiness.id,
        ownerId: activeBusiness.ownerId || auth.currentUser?.uid || '',
        branchId: selectedBranchId || 'main',
        supplierId: formData.supplierId,
        supplierName: selectedSupplier?.name || 'Unknown',
        invoiceNumber: finalInvoiceNumber,
        openingDue: oldDue,
        billAmount: Number(formData.billAmount) || 0,
        paidAmount: Number(formData.paidAmount) || 0,
        amount: Number(formData.billAmount) || 0,
        netDue,
        paymentMode: paymentMode,
        bankAccountId: selectedBankAccountId || '',
        date: new Date().toISOString(),
        createdAt: serverTimestamp(),
      };

      // Add itemized lines with unit and snapshot
      if (billItems.length > 0) {
        logPayload.items = billItems.map(i => ({
          id: i.id,
          productId: i.productId || '',
          productCode: i.productCode || '',
          name: i.name.trim() || 'Item',
          barcode: (i.barcode || '').trim(),
          category: i.category || '',
          unit: i.unit || 'pcs',
          quantity: Number(i.quantity) || 1,
          unitPrice: Number(i.unitPrice) || 0,
          salesPrice: Number(i.salesPrice) || 0,
          totalPrice: Number(i.totalPrice) || 0,
        }));
      }

      if (selectedPOId) {
        logPayload.purchaseOrderId = selectedPOId;
      }

      // Add log to Firestore
      const docRef = await addDoc(collection(db, 'purchaseLogs'), logPayload);

      // Automatically sync purchased items into Supplier's Product Profile Catalog with latest costs
      if (billItems.length > 0 && formData.supplierId) {
        try {
          await saveSupplierProductsFromBill(
            formData.supplierId,
            selectedSupplier?.name || 'Supplier',
            activeBusiness.id,
            billItems,
            logPayload.date
          );
        } catch (syncErr) {
          console.warn('Supplier product catalog auto-sync notice:', syncErr);
        }
      }

      // 2. Update Supplier Due Balance
      const dueDelta = (Number(formData.billAmount) || 0) - (Number(formData.paidAmount) || 0);
      if (dueDelta !== 0) {
        await updateDoc(doc(db, 'suppliers', formData.supplierId), {
          totalDue: increment(dueDelta)
        });
      }

      // 3. Update Bank Account balance & Record Finance Transaction if paid
      if (Number(formData.paidAmount) > 0) {
        if ((paymentMode === 'bank' || paymentMode === 'card' || paymentMode === 'online') && selectedBankAccountId) {
          try {
            await updateDoc(doc(db, 'bankAccounts', selectedBankAccountId), {
              balance: increment(-Number(formData.paidAmount))
            });
            await addDoc(collection(db, 'transactions'), {
              businessId: activeBusiness.id,
              branchId: selectedBranchId || 'global',
              ownerId: activeBusiness.ownerId || auth.currentUser?.uid || '',
              userId: auth.currentUser?.uid,
              amount: Number(formData.paidAmount),
              type: 'expense',
              fromAccount: 'bank',
              fromBankId: selectedBankAccountId,
              category: 'Purchase Bill Payment',
              description: `Paid Inv: ${formData.invoiceNumber} (${selectedSupplier?.name || 'Supplier'})`,
              date: new Date().toISOString(),
              createdAt: serverTimestamp(),
            });
          } catch (bankErr) {
            console.warn('Bank balance deduction error:', bankErr);
          }
        } else if (paymentMode === 'cash') {
          try {
            await addDoc(collection(db, 'transactions'), {
              businessId: activeBusiness.id,
              branchId: selectedBranchId || 'global',
              ownerId: activeBusiness.ownerId || auth.currentUser?.uid || '',
              userId: auth.currentUser?.uid,
              amount: Number(formData.paidAmount),
              type: 'expense',
              fromAccount: 'cash',
              category: 'Purchase Bill Payment',
              description: `Paid Inv: ${formData.invoiceNumber} (${selectedSupplier?.name || 'Supplier'})`,
              date: new Date().toISOString(),
              createdAt: serverTimestamp(),
            });
          } catch (cashErr) {
            console.warn('Cash transaction error:', cashErr);
          }
        }
      }

      // 4. Mark Purchase Order as fulfilled if applicable
      if (selectedPOId) {
        try {
          await updateDoc(doc(db, 'purchaseOrders', selectedPOId), {
            status: 'fulfilled',
            fulfilledAt: serverTimestamp(),
            associatedBillId: docRef.id,
          });
        } catch (e) {
          console.warn('Failed to update PO status:', e);
        }
      }

      // 5. SalesPlay Stock Sync
      const salesPlayItems = billItems.filter(i => i.productId && i.productId.length > 5);
      if (salesPlayItems.length > 0) {
        try {
          const spSettings = await getSalesPlaySettings(activeBusiness.id);
          const mappedShop = (spSettings.branchShopMap && spSettings.branchShopMap[selectedBranchId])
            || spSettings.selectedShopId
            || DEFAULT_SALESPLAY_CONFIG.defaultShopId;

          const updateItems = salesPlayItems.map(i => ({
            productId: i.productId!,
            quantityToAdd: Number(i.quantity) || 1,
          }));

          const spResult = await updateSalesPlayInventory(mappedShop, updateItems, spSettings.apiToken);
          if (spResult.success) {
            await updateDoc(docRef, { syncedToSalesPlay: true, salesPlayShopId: mappedShop });
            toast.success(`SalesPlay inventory updated (+${salesPlayItems.length} products stock)!`);
          }
        } catch (spErr) {
          console.warn('SalesPlay inventory update notice:', spErr);
        }
      }

      toast.success('Purchase bill logged successfully! Supplier product catalog updated.');
      setFormData({ supplierId: '', invoiceNumber: getNextInvoiceNumber(), billAmount: 0, paidAmount: 0 });
      setBillItems([]);
      setSelectedPOId('');
      if (onClearImportedPO) onClearImportedPO();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'purchaseLogs');
      toast.error('Failed to save purchase bill');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Log Purchase Bill"
      className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl space-y-6"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-blue-500">
          <ShoppingCart size={24} />
          <h2 className="text-lg font-black uppercase tracking-widest">Log Purchase Bill</h2>
        </div>
        {activeBusiness && (
          <span className="text-[11px] font-bold text-slate-400 bg-slate-900 px-3 py-1 rounded-full border border-slate-800">
            {activeBusiness.name}
          </span>
        )}
      </div>

      {/* Import from Purchase Order selector */}
      <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-black uppercase tracking-widest text-indigo-400 flex items-center gap-1.5">
            <FileText size={14} /> Select from Purchase Order (Optional)
          </label>
          {selectedPOId && (
            <button
              type="button"
              onClick={() => handleSelectPOFromDropdown('')}
              className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
            >
              Clear PO Selection
            </button>
          )}
        </div>
        <select
          value={selectedPOId}
          onChange={(e) => handleSelectPOFromDropdown(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500"
        >
          <option value="">-- Manual Direct Entry (No PO) --</option>
          {availablePOs.map(po => (
            <option key={po.id} value={po.id}>
              {po.poNumber} • {po.supplierName} • {currency} {formatAmount(po.totalAmount || 0, currency)} ({po.items?.length || 0} items)
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {relevantBranches.length > 0 && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Branch *</label>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
            >
              {relevantBranches.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.branchCode || 'BR'})</option>
              ))}
            </select>
          </div>
        )}

        <div className={cn("space-y-2", relevantBranches.length === 0 && "col-span-full")}>
          <div className="flex items-center justify-between ml-1">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Select Supplier / Party (সাপ্লায়ার / পার্টি) *
            </label>
            {selectedSupplier && (
              <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                Party: {selectedSupplier.name}
              </span>
            )}
          </div>
          <select
            value={formData.supplierId}
            onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-200 focus:border-blue-500 outline-none transition-all"
          >
            <option value="">-- Choose Supplier / Party ({suppliers.length} available) --</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 🌟 Supplier Product Profile & 1-Click Auto-Import Banner */}
      {formData.supplierId && (
        <div className="bg-gradient-to-r from-blue-950/70 via-indigo-950/60 to-purple-950/70 border border-blue-500/30 p-4 rounded-2xl space-y-3 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl shrink-0 mt-0.5 sm:mt-0">
                <Zap size={18} className="animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs sm:text-sm font-black text-white">
                    {selectedSupplier?.name}'s Product Catalog
                  </h4>
                  <span className="text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full">
                    {supplierProducts.length} Products
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-medium">
                  {supplierProducts.length > 0 
                    ? `Click below to import all ${supplierProducts.length} products into this bill at once with real SalesPlay categories. You can modify quantities, enter new costs, or delete unneeded items.`
                    : `No products linked to this supplier yet. You can open catalog management to link items, or just add items below — they will be auto-saved to this profile upon submitting.`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              {supplierProducts.length > 0 && (
                <button
                  type="button"
                  onClick={handleImportAllSupplierProducts}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 text-white font-black px-4 py-2.5 rounded-xl text-xs shadow-lg shadow-blue-950/40 transition-all cursor-pointer active:scale-95 border border-blue-400/30"
                  title="Import entire product profile into bill"
                >
                  <Download size={14} />
                  <span>Import All ({supplierProducts.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => selectedSupplier && setViewingProfileSupplier(selectedSupplier)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold rounded-xl border border-slate-700/80 transition-all cursor-pointer"
                title="View and manage supplier product catalog profile"
              >
                <Package size={14} />
                <span className="hidden md:inline">Manage</span> Catalog
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Itemized Lines (Editable with barcodes and scan input) */}
      <div className="space-y-4 bg-slate-950/40 p-4 rounded-2xl border border-slate-800">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">
            Scan Barcode or Search Product to Add to Bill:
          </label>
          <ProductSearchAndScan
            products={combinedCatalogProducts}
            currency={currency}
            autoFocusScanner={true}
            onSelectProduct={(p) => {
              const isWeight = isWeightItem(p.product_name, p.measurement);
              const defaultUnit: 'kg' | 'pcs' = isWeight ? 'kg' : 'pcs';
              const defaultQty = isWeight ? 1.000 : 1;
              const purchaseCost = (p.cost !== undefined && p.cost !== null && p.cost > 0)
                ? p.cost
                : (p.last_purchase_cost || 0);

              const existingIdx = billItems.findIndex(i => i.productId === p.id);
              if (existingIdx >= 0) {
                const updated = [...billItems];
                const addQty = isWeight ? 1.000 : 1;
                updated[existingIdx].quantity = Math.round((Number(updated[existingIdx].quantity) + addQty) * 1000) / 1000;
                updated[existingIdx].totalPrice = Math.round(Number(updated[existingIdx].quantity) * Number(updated[existingIdx].unitPrice) * 1000) / 1000;
                setBillItems(updated);
                recalcTotal(updated);
                toast.info(`Increased "${p.product_name}" quantity to ${toStrictDecimal3(updated[existingIdx].quantity)} ${updated[existingIdx].unit || 'pcs'}`);
              } else {
                const newItem: PurchaseOrderItem = {
                  id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                  productId: p.id,
                  productCode: p.product_code,
                  name: p.product_name,
                  barcode: p.barcode || p.product_code,
                  category: p.category,
                  unit: defaultUnit,
                  quantity: defaultQty,
                  unitPrice: purchaseCost,
                  salesPrice: p.price || 0,
                  totalPrice: Math.round(defaultQty * purchaseCost * 1000) / 1000,
                  currentStock: p.in_stock || 0,
                  measurement: p.measurement,
                };
                const updated = [...billItems, newItem];
                setBillItems(updated);
                recalcTotal(updated);
              }
            }}
            onAddCustomWithBarcode={(scannedBarcode) => {
              const newItem: PurchaseOrderItem = {
                id: `item_${Date.now()}`,
                name: '',
                barcode: scannedBarcode,
                unit: 'pcs',
                quantity: 1,
                unitPrice: 0,
                totalPrice: 0,
              };
              const updated = [...billItems, newItem];
              setBillItems(updated);
              recalcTotal(updated);
            }}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <BarcodeIcon size={14} className="text-blue-400" />
            Bill Items ({billItems.length})
          </p>
          <div className="flex items-center gap-2">
            {billItems.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setBillItems([]);
                  recalcTotal([]);
                  toast.info('Cleared all items from bill');
                }}
                className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 font-bold px-2 py-1 rounded hover:bg-rose-950/30 transition-all cursor-pointer"
              >
                <Trash2 size={12} /> Clear All
              </button>
            )}
            <button
              type="button"
              onClick={handleAddBillItem}
              className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold py-1.5 px-3 rounded-lg border border-slate-700 cursor-pointer"
            >
              <Plus size={13} /> Add Blank Item
            </button>
          </div>
        </div>

        {billItems.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex md:hidden items-center justify-between px-3 py-1.5 bg-blue-950/40 border border-blue-500/20 rounded-xl text-[11px] text-blue-300">
              <span className="font-semibold">👉 Swipe sideways to view & edit all bill columns</span>
              <span className="font-mono font-bold text-blue-400">{billItems.length} items</span>
            </div>
            <div className="border border-slate-800 rounded-xl overflow-x-auto overflow-y-hidden bg-slate-900/60 scrollbar-thin">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 text-[10px] font-black uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3 min-w-[180px]">Product Name</th>
                    <th className="py-2.5 px-3 min-w-[130px]">Barcode</th>
                    <th className="py-2.5 px-2 w-20 text-center">Unit</th>
                    <th className="py-2.5 px-3 w-24 text-right">Qty</th>
                    <th className="py-2.5 px-3 w-28 text-right">Cost ({currency})</th>
                    <th className="py-2.5 px-3 min-w-[95px] text-right">Total</th>
                    <th className="py-2.5 px-2 w-10 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {billItems.map((item, idx) => {
                    const isKg = item.unit === 'kg';
                    return (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={item.name}
                            onChange={(e) => handleUpdateBillItem(idx, 'name', e.target.value)}
                            placeholder="Item name"
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-slate-100 outline-none min-w-[160px]"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={item.barcode || ''}
                            onChange={(e) => handleUpdateBillItem(idx, 'barcode', e.target.value)}
                            placeholder="Barcode"
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs font-mono text-slate-300 outline-none min-w-[120px]"
                          />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <select
                            value={item.unit || 'pcs'}
                            onChange={(e) => handleUpdateBillItem(idx, 'unit', e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs font-bold text-indigo-400 outline-none"
                          >
                            <option value="pcs">pcs</option>
                            <option value="kg">kg</option>
                          </select>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const step = isKg ? 0.5 : 1;
                                const current = Number(item.quantity) || 1;
                                const newQty = Math.max(isKg ? 0.001 : 1, Math.round((current - step) * 1000) / 1000);
                                handleUpdateBillItem(idx, 'quantity', newQty);
                              }}
                              className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center shrink-0 cursor-pointer text-xs active:scale-95"
                              title="Decrease Quantity"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              step={isKg ? "0.001" : "1"}
                              min="0.001"
                              value={item.quantity}
                              onChange={(e) => handleUpdateBillItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                              placeholder={isKg ? "0.000" : "1"}
                              className="w-14 bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-center text-slate-100 font-bold outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const step = isKg ? 0.5 : 1;
                                const current = Number(item.quantity) || 0;
                                const newQty = Math.round((current + step) * 1000) / 1000;
                                handleUpdateBillItem(idx, 'quantity', newQty);
                              }}
                              className="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold flex items-center justify-center shrink-0 cursor-pointer text-xs active:scale-95"
                              title="Increase Quantity"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={item.unitPrice === 0 ? '' : item.unitPrice}
                            onChange={(e) => handleUpdateBillItem(idx, 'unitPrice', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                            placeholder="0.000"
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-1.5 text-xs text-right text-slate-100 font-mono font-bold outline-none min-w-[85px]"
                          />
                        </td>
                        <td className="py-2 px-3 text-right font-black font-mono text-blue-400 whitespace-nowrap">
                          {currency} {formatAmount(item.totalPrice || 0, currency)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveBillItem(idx)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg cursor-pointer transition-all"
                            title="Remove Item"
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
          <p className="text-[11px] text-slate-500 italic p-1">
            Optional: Add product items to automatically calculate bill total, render barcodes, and sync stock with SalesPlay POS.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="space-y-1">
          <div className="flex items-center justify-between ml-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Invoice / Bill No *
            </label>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, invoiceNumber: getNextInvoiceNumber() })}
              className="text-[9px] text-blue-400 hover:text-blue-300 font-bold underline cursor-pointer"
              title="Generate a new unique bill number"
            >
              🎲 Auto
            </button>
          </div>
          <input
            type="text"
            value={formData.invoiceNumber}
            onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
            placeholder="e.g. BILL-260930-1234"
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-100 font-mono focus:border-blue-500 outline-none"
          />
        </div>
        <InputGroup label={`Prev. Due (${currency})`} value={formatAmount(oldDue, currency)} readOnly color="text-rose-400" type="text" />
        <InputGroup label={`Bill Amount (${currency}) *`} value={formData.billAmount} onChange={(v) => setFormData({ ...formData, billAmount: v as number })} min={0} max={1000000000} step="0.001" />
        <InputGroup label={`Paid Amount (${currency})`} value={formData.paidAmount} onChange={(v) => setFormData({ ...formData, paidAmount: v as number })} min={0} max={1000000000} step="0.001" />
        <div className="col-span-1 sm:col-span-2 lg:col-span-4">
          <InputGroup label={`Net Due (${currency})`} value={formatAmount(netDue, currency)} readOnly color="text-blue-400" type="text" />
        </div>
      </div>

      {/* Payment Mode and Bank Account Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-950/40 p-4 rounded-2xl border border-slate-800">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Payment Mode</label>
          <select
            value={paymentMode}
            onChange={(e) => {
              const mode = e.target.value as any;
              setPaymentMode(mode);
              if (mode === 'due') {
                setFormData(prev => ({ ...prev, paidAmount: 0 }));
              } else if (formData.paidAmount === 0 && formData.billAmount > 0) {
                setFormData(prev => ({ ...prev, paidAmount: prev.billAmount }));
              }
            }}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 font-bold outline-none focus:border-blue-500"
          >
            <option value="cash">Cash (Drawer)</option>
            <option value="bank">Bank Transfer</option>
            <option value="card">Card Payment</option>
            <option value="online">Online / Transfer</option>
            <option value="due">Full Due / Credit (Unpaid)</option>
          </select>
        </div>

        {(paymentMode === 'bank' || paymentMode === 'card' || paymentMode === 'online') && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
              Select Bank Account ({effectiveBankAccounts.length} available) *
            </label>
            <select
              value={selectedBankAccountId}
              onChange={(e) => setSelectedBankAccountId(e.target.value)}
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 font-bold outline-none focus:border-blue-500"
            >
              <option value="">-- Choose Bank Account --</option>
              {effectiveBankAccounts.map(b => (
                <option key={b.id} value={b.id}>
                  {b.bankName} - {b.accountName} ({currency} {formatAmount(b.balance, currency)})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || !formData.supplierId}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20 cursor-pointer"
      >
        {loading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div> : <Save size={20} />}
        Save Purchase Entry
      </button>

      {/* Supplier Products Profile Catalog Modal */}
      {viewingProfileSupplier && (
        <SupplierProductProfileModal
          supplier={viewingProfileSupplier}
          currency={currency}
          businessId={activeBusiness?.id || ''}
          onClose={() => setViewingProfileSupplier(null)}
          onProductsUpdated={() => {
            if (formData.supplierId) {
              getSupplierProducts(formData.supplierId, activeBusiness?.id, false).then(setSupplierProducts);
            }
          }}
        />
      )}
    </div>
  );
}

function AddSupplierForm() {
  const { selectedBusiness, selectedBranch, businesses, branches, isAllBusinessesSelected, userProfile } = useBusiness();
  const [chosenBusinessId, setChosenBusinessId] = useState<string>(selectedBusiness?.id || '');
  const [chosenBranchId, setChosenBranchId] = useState<string>(selectedBranch?.id || '');

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    contactPerson: '',
    category: '',
    email: '',
    address: '',
    country: '',
    openingDue: 0,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedBusiness?.id) {
      setChosenBusinessId(selectedBusiness.id);
    } else if (businesses.length > 0 && !chosenBusinessId) {
      setChosenBusinessId(businesses[0].id);
    }
  }, [selectedBusiness, businesses]);

  useEffect(() => {
    if (selectedBranch?.id) {
      setChosenBranchId(selectedBranch.id);
    }
  }, [selectedBranch]);

  const activeBusiness = businesses.find(b => b.id === chosenBusinessId) || selectedBusiness || businesses[0];
  const activeBranches = branches.filter(b => activeBusiness && b.businessId === activeBusiness.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBusiness) {
      toast.error('No business selected. Please create or select a business first.');
      return;
    }
    if (!formData.name.trim()) {
      toast.error('Supplier name is required');
      return;
    }
    if (!formData.phone.trim()) {
      toast.error('Phone number is required');
      return;
    }

    setLoading(true);
    try {
      const supplierData: Record<string, any> = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        businessId: activeBusiness.id,
        ownerId: activeBusiness.ownerId || auth.currentUser?.uid || '',
        totalDue: Number(formData.openingDue) || 0,
      };

      const isBranchManager = userProfile?.role === 'branch_manager';
      if (isBranchManager && selectedBranch?.id) {
        supplierData.branchId = selectedBranch.id;
      } else if (chosenBranchId && chosenBranchId !== 'global') {
        supplierData.branchId = chosenBranchId;
      }

      if (formData.contactPerson.trim()) supplierData.contactPerson = formData.contactPerson.trim();
      if (formData.category.trim()) supplierData.category = formData.category.trim();
      if (formData.email.trim()) supplierData.email = formData.email.trim();
      if (formData.address.trim()) supplierData.address = formData.address.trim();
      if (formData.country.trim()) supplierData.country = formData.country.trim();

      await addDoc(collection(db, 'suppliers'), supplierData);
      toast.success(`Supplier "${formData.name.trim()}" added successfully!`);
      setFormData({
        name: '',
        phone: '',
        contactPerson: '',
        category: '',
        email: '',
        address: '',
        country: '',
        openingDue: 0,
      });
    } catch (error) {
      console.error('Add supplier error:', error);
      handleFirestoreError(error, OperationType.WRITE, 'suppliers');
      toast.error('Failed to add supplier. Please verify business permission.');
    } finally {
      setLoading(false);
    }
  };

  if (businesses.length === 0) {
    return (
      <div className="bg-[#1E293B] p-8 rounded-3xl border border-slate-800 shadow-xl text-center space-y-3">
        <AlertCircle size={32} className="mx-auto text-amber-500" />
        <p className="text-slate-200 font-bold">No Business Found</p>
        <p className="text-slate-400 text-xs">Please create or register a business first before adding suppliers.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[#1E293B] p-6 rounded-3xl border border-emerald-500/20 shadow-xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-emerald-500">
          <UserPlus size={24} />
          <h2 className="text-lg font-black uppercase tracking-widest">Add New Supplier</h2>
        </div>
        {activeBusiness && (
          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1.5">
            <Building2 size={12} />
            {activeBusiness.name}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isAllBusinessesSelected && businesses.length > 1 && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Business *</label>
            <select
              value={chosenBusinessId}
              onChange={(e) => setChosenBusinessId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-200 focus:border-emerald-500 outline-none transition-all"
            >
              {businesses.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}

        {userProfile?.role !== 'branch_manager' && activeBranches.length > 0 && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Branch Scope</label>
            <select
              value={chosenBranchId}
              onChange={(e) => setChosenBranchId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-200 focus:border-emerald-500 outline-none transition-all"
            >
              <option value="global">All Branches (Global Supplier)</option>
              {activeBranches.map(br => (
                <option key={br.id} value={br.id}>{br.name} ({br.branchCode || 'BR'})</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <InputGroup 
          label="Supplier / Company Name *" 
          value={formData.name} 
          onChange={(v) => setFormData({ ...formData, name: v as string })} 
          type="text" 
          maxLength={100} 
        />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputGroup 
            label="Phone Number *" 
            value={formData.phone} 
            onChange={(v) => setFormData({ ...formData, phone: v as string })} 
            type="text" 
            maxLength={30} 
          />
          <InputGroup 
            label="Contact Person" 
            value={formData.contactPerson} 
            onChange={(v) => setFormData({ ...formData, contactPerson: v as string })} 
            type="text" 
            maxLength={100} 
          />
          <InputGroup 
            label="Category / Goods Supplied" 
            value={formData.category} 
            onChange={(v) => setFormData({ ...formData, category: v as string })} 
            type="text" 
            maxLength={100} 
          />
          <InputGroup 
            label="Email Address" 
            value={formData.email} 
            onChange={(v) => setFormData({ ...formData, email: v as string })} 
            type="text" 
            maxLength={100} 
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputGroup 
            label="Address" 
            value={formData.address} 
            onChange={(v) => setFormData({ ...formData, address: v as string })} 
            type="text" 
            maxLength={500} 
          />
          <InputGroup 
            label={`Opening / Previous Due (${activeBusiness?.currency || '$'})`} 
            value={formData.openingDue} 
            onChange={(v) => setFormData({ ...formData, openingDue: v as number })} 
            type="number" 
            min={0}
            max={1000000000}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-emerald-900/20 cursor-pointer"
      >
        {loading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div> : <Save size={20} />}
        Add Supplier
      </button>
    </form>
  );
}

/**
 * Recent Purchase Logs with Bill Receipt Print/Download & Purchase Report Export
 */
function RecentLogs({
  logs,
  currency,
  branches,
  businesses,
  isAllBusinessesSelected,
  suppliers,
}: {
  logs: PurchaseLog[];
  currency: string;
  branches: Branch[];
  businesses: Business[];
  isAllBusinessesSelected: boolean;
  suppliers: Supplier[];
}) {
  const { userProfile } = useBusiness();
  const isAdmin = userProfile?.role === 'admin' || auth.currentUser?.email === 'shomedesk@gmail.com';
  const [selectedLogForReceipt, setSelectedLogForReceipt] = useState<PurchaseLog | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteLog = async (log: PurchaseLog) => {
    if (!log.id || !isAdmin) return;
    setDeletingId(log.id);
    try {
      // 1. Delete purchase log
      await deleteDoc(doc(db, 'purchaseLogs', log.id));

      // 2. Revert supplier due
      const delta = (Number(log.billAmount) || 0) - (Number(log.paidAmount) || 0);
      if (delta !== 0 && log.supplierId) {
        await updateDoc(doc(db, 'suppliers', log.supplierId), {
          totalDue: increment(-delta),
        });
      }

      // 3. Restore PO if linked
      if (log.purchaseOrderId) {
        try {
          await updateDoc(doc(db, 'purchaseOrders', log.purchaseOrderId), {
            status: 'pending',
            associatedBillId: null,
          });
        } catch (e) {
          console.warn('Failed to revert PO status:', e);
        }
      }

      toast.success(`Purchase bill #${log.invoiceNumber} deleted from database`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'purchaseLogs');
      toast.error('Failed to delete purchase bill');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3 text-slate-400">
          <History size={20} />
          <h3 className="text-xs font-black uppercase tracking-[0.2em]">Recent Purchase Logs</h3>
        </div>

        {logs.length > 0 && (
          <button
            onClick={() => setShowReportModal(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2 px-3.5 rounded-xl border border-slate-700 transition-all cursor-pointer self-start sm:self-auto"
          >
            <Download size={14} className="text-emerald-400" />
            Download Purchase Report (Excel / PDF)
          </button>
        )}
      </div>

      <div className="space-y-3">
        {logs.slice(0, 15).map(log => {
          const supplierObj = suppliers.find(s => s.id === log.supplierId);
          const branchObj = branches.find(b => b.id === log.branchId);
          const businessObj = businesses.find(b => b.id === log.businessId);

          return (
            <div
              key={log.id}
              className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-all"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-200">{log.supplierName}</p>
                  {log.items && log.items.length > 0 && (
                    <span className="text-[10px] bg-blue-950 text-blue-400 px-2 py-0.5 rounded-full border border-blue-800">
                      {log.items.length} items
                    </span>
                  )}
                  {log.syncedToSalesPlay && (
                    <span className="text-[10px] bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-800">
                      SalesPlay Synced
                    </span>
                  )}
                  {log.paymentMode && (
                    <span className="text-[10px] bg-indigo-950 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-800 font-bold uppercase">
                      {log.paymentMode}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  <span>INV: {log.invoiceNumber}</span>
                  <span className="text-slate-700">•</span>
                  <span>{log.date ? format(new Date(log.date), 'MMM dd, yyyy') : 'Recent'}</span>
                  {log.branchId && (
                    <>
                      <span className="text-slate-700">•</span>
                      <span className="text-blue-400">{branchObj?.name || 'Branch'}</span>
                    </>
                  )}
                  {isAllBusinessesSelected && (
                    <>
                      <span className="text-slate-700">•</span>
                      <span className="text-amber-400">{businessObj?.name || 'Business'}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 self-end sm:self-auto">
                <div className="text-right mr-1">
                  <p className="text-sm font-black text-blue-400 font-mono">
                    {currency} {formatAmount(log.billAmount || (log as any).amount || 0, currency)}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                    Paid: {currency} {formatAmount(log.paidAmount || 0, currency)}
                  </p>
                </div>

                {/* View / Download Bill Receipt Button */}
                <button
                  onClick={() => setSelectedLogForReceipt(log)}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black py-2.5 px-3 rounded-xl shadow-md shadow-blue-950/40 cursor-pointer transition-all active:scale-95"
                  title="View and Download Bill PDF"
                >
                  <Download size={14} />
                  <span>PDF Receipt</span>
                </button>

                {/* Admin Delete Button */}
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteLog(log)}
                    disabled={deletingId === log.id}
                    className="p-2.5 bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-800 rounded-xl transition-all cursor-pointer"
                    title="Admin: Delete Purchase Log"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {logs.length === 0 && (
          <div className="p-8 text-center text-slate-500 font-bold uppercase tracking-widest text-xs">
            No purchase logs found
          </div>
        )}
      </div>

      {/* Bill Receipt Modal */}
      {selectedLogForReceipt && (
        <BillReceiptModal
          log={selectedLogForReceipt}
          onClose={() => setSelectedLogForReceipt(null)}
          currency={currency}
          business={businesses.find(b => b.id === selectedLogForReceipt.businessId) || null}
          branch={branches.find(b => b.id === selectedLogForReceipt.branchId) || null}
          supplier={suppliers.find(s => s.id === selectedLogForReceipt.supplierId) || null}
        />
      )}

      {/* Purchase Report Modal */}
      {showReportModal && (
        <PurchaseReportModal
          logs={logs}
          suppliers={suppliers}
          branches={branches}
          businesses={businesses}
          currency={currency}
          onClose={() => setShowReportModal(false)}
          selectedBusiness={businesses[0] || null}
        />
      )}
    </div>
  );
}

function SupplierDirectory({ suppliers, currency, businesses, branches, isAllBusinessesSelected }: { suppliers: Supplier[]; currency: string; businesses: Business[]; branches: Branch[]; isAllBusinessesSelected: boolean }) {
  const { userProfile } = useBusiness();
  const isAdmin = userProfile?.role === 'admin' || auth.currentUser?.email === 'shomedesk@gmail.com';
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingSupplierId, setDeletingSupplierId] = useState<string | null>(null);
  const [activeCatalogSupplier, setActiveCatalogSupplier] = useState<Supplier | null>(null);

  const handleDeleteSupplier = async (supplier: Supplier) => {
    if (!supplier.id || !isAdmin) return;
    setDeletingSupplierId(supplier.id);
    try {
      await deleteDoc(doc(db, 'suppliers', supplier.id));
      toast.success(`Supplier "${supplier.name}" removed from database`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'suppliers');
      toast.error('Failed to delete supplier');
    } finally {
      setDeletingSupplierId(null);
    }
  };

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return suppliers;
    const term = searchTerm.toLowerCase();
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(term) ||
      (s.phone && s.phone.includes(term)) ||
      (s.contactPerson && s.contactPerson.toLowerCase().includes(term)) ||
      (s.category && s.category.toLowerCase().includes(term))
    );
  }, [suppliers, searchTerm]);

  return (
    <div className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-slate-400">
          <Truck size={20} />
          <h3 className="text-xs font-black uppercase tracking-[0.2em]">Supplier Directory ({filtered.length})</h3>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search suppliers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-emerald-500 outline-none transition-all"
          />
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map(s => {
          const branchObj = s.branchId ? branches.find(b => b.id === s.branchId) : null;
          const businessObj = businesses.find(b => b.id === s.businessId);

          return (
            <div key={s.id} className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 flex justify-between items-center hover:border-slate-700 transition-all">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-200">{s.name}</p>
                  {s.category && (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                      {s.category}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500">
                  <span className="text-slate-400">{s.phone}</span>
                  {s.contactPerson && (
                    <>
                      <span className="text-slate-700">•</span>
                      <span>Contact: {s.contactPerson}</span>
                    </>
                  )}
                  {branchObj && (
                    <>
                      <span className="text-slate-700">•</span>
                      <span className="text-blue-400 flex items-center gap-1">
                        <MapPin size={10} />
                        {branchObj.name}
                      </span>
                    </>
                  )}
                  {isAllBusinessesSelected && businessObj && (
                    <>
                      <span className="text-slate-700">•</span>
                      <span className="text-amber-400">{businessObj.name}</span>
                    </>
                  )}
                </div>
                {s.address && (
                  <p className="text-[10px] text-slate-500 truncate max-w-xs sm:max-w-md">{s.address}</p>
                )}
              </div>
              <div className="flex items-center gap-3 pl-4">
                <button
                  type="button"
                  onClick={() => setActiveCatalogSupplier(s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0"
                  title={`View products catalog for ${s.name}`}
                >
                  <Package size={13} />
                  <span className="hidden sm:inline">Product Profile</span>
                </button>

                <div className="text-right">
                  <p className={cn("text-sm font-black font-mono", (s.totalDue || 0) > 0 ? "text-rose-400" : "text-emerald-400")}>
                    {currency} {formatAmount(s.totalDue || 0, currency)}
                  </p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Due</p>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDeleteSupplier(s)}
                    disabled={deletingSupplierId === s.id}
                    className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-xl transition-all cursor-pointer"
                    title="Admin: Delete Supplier"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="p-8 text-center text-slate-500 font-bold uppercase tracking-widest text-xs">
            {searchTerm ? 'No suppliers match your search' : 'No suppliers added yet'}
          </div>
        )}
      </div>

      {/* Supplier Product Profile Catalog Modal */}
      {activeCatalogSupplier && (
        <SupplierProductProfileModal
          supplier={activeCatalogSupplier}
          currency={currency}
          businessId={activeCatalogSupplier.businessId || ''}
          onClose={() => setActiveCatalogSupplier(null)}
        />
      )}
    </div>
  );
}

function InputGroup({ 
  label, 
  value, 
  onChange, 
  readOnly, 
  type = "number", 
  color, 
  maxLength, 
  min, 
  max,
  step = "any"
}: { 
  label: string; 
  value: string | number; 
  onChange?: (v: string | number) => void; 
  readOnly?: boolean; 
  type?: string; 
  color?: string; 
  maxLength?: number; 
  min?: number; 
  max?: number; 
  step?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">{label}</label>
      <input
        type={type}
        step={type === "number" ? step : undefined}
        value={value === 0 && type === "number" ? '' : value}
        onChange={(e) => onChange?.(type === "number" ? (e.target.value === '' ? 0 : parseFloat(e.target.value) || 0) : e.target.value)}
        readOnly={readOnly}
        maxLength={maxLength || (type === "text" ? 100 : undefined)}
        min={min !== undefined ? min : (type === "number" ? 0 : undefined)}
        max={max !== undefined ? max : (type === "number" ? 1000000000 : undefined)}
        className={cn(
          "w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-200 focus:border-emerald-500 outline-none transition-all",
          readOnly && "opacity-90 bg-slate-950 font-mono font-bold cursor-not-allowed",
          color
        )}
      />
    </div>
  );
}
