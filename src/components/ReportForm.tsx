import React, { useState, useEffect, useMemo } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, doc, updateDoc, deleteDoc, increment, getDoc } from 'firebase/firestore';
import { DailyReport, Transaction, ExpenseItem, PurchaseLog, TransferRow, BankToBankRow } from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import { Save, Calculator, FileText, Wallet, Landmark, ArrowRightLeft, History, Calendar, Banknote, Plus, Eye, Edit2, Trash2, Printer, Download, ChevronLeft, ChevronRight, X, ShieldAlert, FileSpreadsheet, Receipt, ShoppingCart, RefreshCw, CreditCard, Globe } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { formatAmount, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import { format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { MonthlyStatementModal } from './MonthlyStatementModal';
import { ExpensesBreakdownModal } from './ExpensesBreakdownModal';
import { DailyClosingStatementModal } from './DailyClosingStatementModal';
import { syncSalesPlaySalesToFirestore } from '@/src/services/salesplay';
import { generateDailyReportPdf } from '@/src/lib/pdfUtils';

export default function ReportForm() {
  const { selectedBusiness, selectedBranch, selectedService, branches, services, bankAccounts, userProfile } = useBusiness();
  const isAdmin = userProfile?.role === 'admin' || auth.currentUser?.email === 'shomedesk@gmail.com';
  const currency = selectedBranch?.currency || selectedBusiness?.currency || 'OMR';

  // 1. Sales Revenue State (3-Box Split: Cash, Online, Card)
  const [formData, setFormData] = useState({
    openingCash: 0,
    openingBank: 0,
    cashSale: 0,
    onlineSale: 0,
    cardSale: 0,
    bankSale: 0,
    cashExpense: 0,
    bankExpense: 0,
    note: '',
  });
  const [selectedBankId, setSelectedBankId] = useState('');
  const [cardBankId, setCardBankId] = useState('');
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);
  const [isStatementOpen, setIsStatementOpen] = useState(false);
  const [closingReportToView, setClosingReportToView] = useState<DailyReport | null>(null);

  // Itemized Expenses State
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [todayPurchaseBills, setTodayPurchaseBills] = useState<PurchaseLog[]>([]);
  const [reportToDelete, setReportToDelete] = useState<DailyReport | null>(null);

  // Pending Purchase Bills (Accounts Payable) State
  const [pendingBills, setPendingBills] = useState<PurchaseLog[]>([]);
  const [selectedPendingBillId, setSelectedPendingBillId] = useState<string>('');
  const [pendingPaymentAmount, setPendingPaymentAmount] = useState<number>(0);
  const [pendingPaymentMode, setPendingPaymentMode] = useState<'cash' | 'bank'>('cash');
  const [pendingPaymentBankId, setPendingPaymentBankId] = useState<string>('');
  const [billPayments, setBillPayments] = useState<{
    billId: string;
    invoiceNumber: string;
    supplierName: string;
    totalBillAmount: number;
    remainingDue: number;
    paymentAmount: number;
    paymentMode: 'cash' | 'bank';
    bankId?: string;
    bankName?: string;
  }[]>([]);

  // 2. Multiple Dynamic Transfer Rows State (Multi-Entry Support)
  const [cashToBankRows, setCashToBankRows] = useState<TransferRow[]>([
    { id: `c2b_init`, amount: 0, bankId: '' }
  ]);
  const [bankToCashRows, setBankToCashRows] = useState<TransferRow[]>([
    { id: `b2c_init`, amount: 0, bankId: '' }
  ]);
  const [bankToBankRows, setBankToBankRows] = useState<BankToBankRow[]>([]);

  // Edit State for Admin
  const [editingReport, setEditingReport] = useState<DailyReport | null>(null);
  const [editFormData, setEditFormData] = useState({
    date: '',
    openingCash: 0,
    openingBank: 0,
    cashSale: 0,
    onlineSale: 0,
    cardSale: 0,
    bankSale: 0,
    cashExpense: 0,
    bankExpense: 0,
    bankToCash: 0,
    cashToBank: 0,
    note: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [isImportingSalesPlay, setIsImportingSalesPlay] = useState(false);

  // Quick 1-click import of Today's Sales directly from SalesPlay POS into Daily Report
  // Automatically maps to CASH SALE, ONLINE SALE, and CARD SALE
  const handleImportSalesPlayTodaySales = async () => {
    if (!selectedBusiness) {
      toast.error('Please select a business first');
      return;
    }
    setIsImportingSalesPlay(true);
    const toastId = toast.loading('Connecting to SalesPlay POS and importing today\'s sales...');
    try {
      const today = new Date();
      const res = await syncSalesPlaySalesToFirestore({
        businessId: selectedBusiness.id,
        ownerId: selectedBusiness.ownerId || auth.currentUser?.uid || '',
        branchId: selectedBranch?.id || 'main',
        startDate: startOfDay(today),
        endDate: endOfDay(today),
      });

      if (res.success && res.importedCount > 0) {
        setFormData(prev => ({
          ...prev,
          cashSale: res.cashTotal,
          onlineSale: res.onlineTotal,
          cardSale: res.cardTotal,
          bankSale: toStrictDecimal3(res.cardTotal + res.onlineTotal),
        }));
        toast.success(
          `Imported ${res.importedCount} receipts from SalesPlay POS! Cash: ${currency} ${formatAmount(res.cashTotal, currency)} | Online: ${currency} ${formatAmount(res.onlineTotal, currency)} | Card: ${currency} ${formatAmount(res.cardTotal, currency)}`,
          { id: toastId, duration: 6000 }
        );
      } else {
        toast.info(res.message || 'No sales found in SalesPlay for today.', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to import sales from SalesPlay POS', { id: toastId });
    } finally {
      setIsImportingSalesPlay(false);
    }
  };

  // Filter & Pagination State
  const [dateFilter, setDateFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 10;

  const branchBankAccounts = useMemo(() => {
    return bankAccounts.filter(ba => 
      ba.businessId === selectedBusiness?.id && 
      (selectedBranch ? ba.branchId === selectedBranch.id : (selectedService ? ba.serviceId === selectedService.id : true))
    );
  }, [bankAccounts, selectedBusiness?.id, selectedBranch?.id, selectedService?.id]);

  useEffect(() => {
    if (branchBankAccounts.length > 0) {
      const defaultBankId = branchBankAccounts[0].id;
      setSelectedBankId(prev => (prev && branchBankAccounts.some(b => b.id === prev) ? prev : defaultBankId));
      setCardBankId(prev => (prev && branchBankAccounts.some(b => b.id === prev) ? prev : (branchBankAccounts[1]?.id || defaultBankId)));

      setCashToBankRows(prev => {
        const needsUpdate = prev.some(r => !r.bankId);
        if (!needsUpdate) return prev;
        return prev.map(r => r.bankId ? r : { ...r, bankId: defaultBankId });
      });

      setBankToCashRows(prev => {
        const needsUpdate = prev.some(r => !r.bankId);
        if (!needsUpdate) return prev;
        return prev.map(r => r.bankId ? r : { ...r, bankId: defaultBankId });
      });
    }
  }, [branchBankAccounts]);

  useEffect(() => {
    if (!selectedBusiness) return;

    const q = query(
      collection(db, 'dailyReports'), 
      where('businessId', '==', selectedBusiness.id),
      ...(selectedBranch ? [where('branchId', '==', selectedBranch.id)] : []),
      ...(selectedService ? [where('serviceId', '==', selectedService.id)] : []),
      orderBy('date', 'desc'), 
      limit(200)
    );
    
    const unsub = onSnapshot(q, async (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DailyReport));
      setReports(list);
      
      if (selectedBranch && list.length > 0) {
        const lastReport = list[0];
        setFormData(prev => ({
          ...prev,
          openingCash: lastReport.closingCash,
          openingBank: lastReport.closingBank,
        }));
      } else if (selectedService && list.length > 0) {
        const lastReport = list[0];
        setFormData(prev => ({
          ...prev,
          openingCash: lastReport.closingCash,
          openingBank: lastReport.closingBank,
        }));
      } else if (selectedBranch || selectedService) {
        // No previous reports, fetch current balances from Finance
        try {
          // Get current bank balance for this branch
          const currentBankBalance = branchBankAccounts.reduce((acc, ba) => acc + ba.balance, 0);
          
          // Get current cash balance for this branch/service
          const cashQuery = query(
            collection(db, 'transactions'),
            where('businessId', '==', selectedBusiness.id),
            ...(selectedBranch ? [where('branchId', '==', selectedBranch.id)] : []),
            ...(selectedService ? [where('serviceId', '==', selectedService.id)] : []),
            where('ownerId', '==', auth.currentUser?.uid)
          );
          const cashSnap = await getDocs(cashQuery);
          const currentCashBalance = cashSnap.docs.reduce((acc, d) => {
            const t = d.data() as Transaction;
            if (t.toAccount === 'cash') return acc + t.amount;
            if (t.fromAccount === 'cash') return acc - t.amount;
            return acc;
          }, 0);

          setFormData(prev => ({
            ...prev,
            openingCash: currentCashBalance,
            openingBank: currentBankBalance,
          }));
        } catch (err) {
          console.error('Failed to fetch initial balances:', err);
        }
      } else {
        setFormData(prev => ({
          ...prev,
          openingCash: 0,
          openingBank: 0,
        }));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'dailyReports');
    });

    return () => unsub();
  }, [selectedBusiness, selectedBranch, selectedService]);

  // Listen for today's purchase bills to enable quick expense breakdown import
  useEffect(() => {
    if (!selectedBusiness) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const q = query(
      collection(db, 'purchaseLogs'),
      where('businessId', '==', selectedBusiness.id),
      ...(selectedBranch ? [where('branchId', '==', selectedBranch.id)] : [])
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseLog));
      const todays = logs.filter(l => l.date && l.date.startsWith(todayStr));
      setTodayPurchaseBills(todays);
    }, (err) => {
      console.warn('Failed to load today purchase logs:', err);
    });
    return () => unsub();
  }, [selectedBusiness, selectedBranch]);

  // Auto-fetch all Pending Purchase Bills (where netDue > 0)
  useEffect(() => {
    if (!selectedBusiness) {
      setPendingBills([]);
      return;
    }
    const q = query(
      collection(db, 'purchaseLogs'),
      where('businessId', '==', selectedBusiness.id),
      ...(selectedBranch ? [where('branchId', '==', selectedBranch.id)] : [])
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseLog));
      const due = logs.filter(l => {
        const billAmt = Number(l.billAmount) || 0;
        const paidAmt = Number(l.paidAmount) || 0;
        const netDue = l.netDue !== undefined && l.netDue !== null ? Number(l.netDue) : (billAmt - paidAmt);
        return netDue > 0.0001;
      });
      setPendingBills(due);
    }, (err) => {
      console.warn('Silent notice loading pending purchase bills:', err);
    });
    return () => unsub();
  }, [selectedBusiness, selectedBranch]);

  // Reset page when filter or branch changes
  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, selectedBranch, selectedService, selectedBusiness]);

  // Prevent background scrolling when Statement or View Report modal is open
  useEffect(() => {
    if (isStatementOpen || selectedReport || isExpenseModalOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isStatementOpen, selectedReport, isExpenseModalOpen]);

  const handleSelectPendingBill = (billId: string) => {
    setSelectedPendingBillId(billId);
    const bill = pendingBills.find(b => b.id === billId);
    if (bill) {
      const billAmt = Number(bill.billAmount) || 0;
      const paidAmt = Number(bill.paidAmount) || 0;
      const netDue = bill.netDue !== undefined && bill.netDue !== null ? Number(bill.netDue) : (billAmt - paidAmt);
      setPendingPaymentAmount(netDue);
    } else {
      setPendingPaymentAmount(0);
    }
  };

  const handleAddBillPayment = () => {
    if (!selectedPendingBillId) {
      toast.error('Please select a pending bill');
      return;
    }
    const bill = pendingBills.find(b => b.id === selectedPendingBillId);
    if (!bill) return;

    const amt = Number(pendingPaymentAmount) || 0;
    if (amt <= 0) {
      toast.error('Payment amount must be greater than 0');
      return;
    }

    const billAmt = Number(bill.billAmount) || 0;
    const paidAmt = Number(bill.paidAmount) || 0;
    const netDue = bill.netDue !== undefined && bill.netDue !== null ? Number(bill.netDue) : (billAmt - paidAmt);

    if (amt > netDue + 0.001) {
      toast.error(`Payment cannot exceed due amount of ${currency} ${formatAmount(netDue, currency)}`);
      return;
    }

    const targetBank = pendingPaymentMode === 'bank' 
      ? (branchBankAccounts.find(b => b.id === (pendingPaymentBankId || selectedBankId)) || branchBankAccounts[0])
      : undefined;

    const existingIdx = billPayments.findIndex(p => p.billId === bill.id);
    const newPayment = {
      billId: bill.id!,
      invoiceNumber: bill.invoiceNumber || 'N/A',
      supplierName: bill.supplierName || 'Supplier',
      totalBillAmount: billAmt,
      remainingDue: netDue - amt,
      paymentAmount: amt,
      paymentMode: pendingPaymentMode,
      bankId: targetBank?.id,
      bankName: targetBank ? `${targetBank.bankName} - ${targetBank.accountName}` : undefined,
    };

    if (existingIdx >= 0) {
      const updated = [...billPayments];
      updated[existingIdx] = newPayment;
      setBillPayments(updated);
    } else {
      setBillPayments(prev => [...prev, newPayment]);
    }

    toast.success(`Added ${currency} ${formatAmount(amt, currency)} payment for Bill #${bill.invoiceNumber}`);
    setSelectedPendingBillId('');
    setPendingPaymentAmount(0);
  };

  const handleRemoveBillPayment = (billId: string) => {
    setBillPayments(prev => prev.filter(p => p.billId !== billId));
  };

  // -------------------------------------------------------------------
  // Dynamic Multi-Row Transfer Handlers (Cash <-> Bank & Bank to Bank)
  // -------------------------------------------------------------------
  const handleAddCashToBankRow = () => {
    setCashToBankRows(prev => [
      ...prev,
      { id: `c2b_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, amount: 0, bankId: selectedBankId || branchBankAccounts[0]?.id || '' }
    ]);
  };
  const handleUpdateCashToBankRow = (id: string, field: 'amount' | 'bankId', value: any) => {
    setCashToBankRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const handleRemoveCashToBankRow = (id: string) => {
    setCashToBankRows(prev => prev.filter(r => r.id !== id));
  };

  const handleAddBankToCashRow = () => {
    setBankToCashRows(prev => [
      ...prev,
      { id: `b2c_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, amount: 0, bankId: selectedBankId || branchBankAccounts[0]?.id || '' }
    ]);
  };
  const handleUpdateBankToCashRow = (id: string, field: 'amount' | 'bankId', value: any) => {
    setBankToCashRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const handleRemoveBankToCashRow = (id: string) => {
    setBankToCashRows(prev => prev.filter(r => r.id !== id));
  };

  const handleAddBankToBankRow = () => {
    const fromId = branchBankAccounts[0]?.id || selectedBankId || '';
    const toId = branchBankAccounts[1]?.id || branchBankAccounts[0]?.id || '';
    setBankToBankRows(prev => [
      ...prev,
      { id: `b2b_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, amount: 0, fromBankId: fromId, toBankId: toId }
    ]);
  };
  const handleUpdateBankToBankRow = (id: string, field: 'amount' | 'fromBankId' | 'toBankId', value: any) => {
    setBankToBankRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const handleRemoveBankToBankRow = (id: string) => {
    setBankToBankRows(prev => prev.filter(r => r.id !== id));
  };

  const totalCashToBank = useMemo(() => {
    return cashToBankRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }, [cashToBankRows]);

  const totalBankToCash = useMemo(() => {
    return bankToCashRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }, [bankToCashRows]);

  const totalBankToBank = useMemo(() => {
    return bankToBankRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }, [bankToBankRows]);

  // Liquidity Calculations with Accounts Payable (no double counting in Operating Expenses)
  const totalPendingBillsPaidCash = billPayments
    .filter(p => p.paymentMode === 'cash')
    .reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);

  const totalPendingBillsPaidBank = billPayments
    .filter(p => p.paymentMode === 'bank')
    .reduce((sum, p) => sum + (Number(p.paymentAmount) || 0), 0);

  // 3-Box Sales Revenue Calculations (Cash, Online, Card)
  const cashSale = Number(formData.cashSale) || 0;
  const onlineSale = Number(formData.onlineSale) || 0;
  const cardSale = Number(formData.cardSale) || 0;
  const electronicSales = toStrictDecimal3(onlineSale + cardSale);
  const totalSalesRevenue = toStrictDecimal3(cashSale + onlineSale + cardSale);

  // Closing Cash: Opening cash + cash sale + bank to cash - cash expenses - cash to bank - supplier cash bills
  const closingCash = toStrictDecimal3(
    (Number(formData.openingCash) || 0) + 
    cashSale + 
    totalBankToCash - 
    (Number(formData.cashExpense) || 0) - 
    totalCashToBank - 
    totalPendingBillsPaidCash
  );

  // Closing Bank: Opening bank + electronic/card/online sales + cash to bank - bank expenses - bank to cash - supplier bank bills
  const closingBank = toStrictDecimal3(
    (Number(formData.openingBank) || 0) + 
    electronicSales + 
    totalCashToBank - 
    (Number(formData.bankExpense) || 0) - 
    totalBankToCash - 
    totalPendingBillsPaidBank
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !selectedBusiness || (!selectedBranch && !selectedService)) return;

    setLoading(true);
    try {
      const cashSale = Number(formData.cashSale) || 0;
      const onlineSale = Number(formData.onlineSale) || 0;
      const cardSale = Number(formData.cardSale) || 0;
      const totalSale = cashSale + onlineSale + cardSale;
      const cashExpense = Number(formData.cashExpense) || 0;
      const bankExpense = Number(formData.bankExpense) || 0;
      
      // Strict Accounting Safeguard:
      // Total Operating Expenses ONLY contains daily operating expenses (rent, salary, utilities).
      // Pending bill payments are Accounts Payable asset-liability exchanges, NOT operating expenses!
      const totalExpense = cashExpense + bankExpense;
      const cogs = 0;
      const grossProfit = totalSale - cogs;
      const netProfit = grossProfit - totalExpense;

      const report: DailyReport = {
        businessId: selectedBusiness.id,
        ownerId: selectedBusiness.ownerId,
        branchId: selectedBranch?.id || 'global',
        serviceId: selectedService?.id || 'global',
        managerId: auth.currentUser.uid,
        date: new Date().toISOString(),
        openingCash: Number(formData.openingCash) || 0,
        openingBank: Number(formData.openingBank) || 0,
        cashSale: toStrictDecimal3(cashSale),
        onlineSale: toStrictDecimal3(onlineSale),
        cardSale: toStrictDecimal3(cardSale),
        bankSale: toStrictDecimal3(electronicSales),
        totalSale: toStrictDecimal3(totalSale),
        cogs: 0,
        grossProfit: toStrictDecimal3(grossProfit),
        cashExpense: toStrictDecimal3(cashExpense),
        bankExpense: toStrictDecimal3(bankExpense),
        cardExpense: 0,
        totalExpense: toStrictDecimal3(totalExpense),
        netProfit: toStrictDecimal3(netProfit),
        bankToCash: toStrictDecimal3(totalBankToCash),
        cashToBank: toStrictDecimal3(totalCashToBank),
        bankToBank: toStrictDecimal3(totalBankToBank),
        bankToCashRows: bankToCashRows.filter(r => r.amount > 0),
        cashToBankRows: cashToBankRows.filter(r => r.amount > 0),
        bankToBankRows: bankToBankRows.filter(r => r.amount > 0),
        closingCash: toStrictDecimal3(closingCash),
        closingBank: toStrictDecimal3(closingBank),
        expenseItems: expenseItems.length > 0 ? expenseItems : undefined,
        note: formData.note || '',
        createdAt: serverTimestamp(),
      };

      // 1. Save the report
      const reportRef = await addDoc(collection(db, 'dailyReports'), report);

      // Save individual expense records to 'expenses' collection for detailed expense reporting
      if (expenseItems.length > 0) {
        try {
          await Promise.all(
            expenseItems.map(exp => addDoc(collection(db, 'expenses'), {
              businessId: selectedBusiness.id,
              ownerId: selectedBusiness.ownerId,
              branchId: selectedBranch?.id || 'global',
              serviceId: selectedService?.id || 'global',
              reportId: reportRef.id,
              category: exp.category,
              amount: Number(exp.amount) || 0,
              paymentType: exp.paymentType,
              bankId: exp.bankId || '',
              bankName: exp.bankName || '',
              note: exp.note || '',
              date: new Date().toISOString(),
              createdAt: serverTimestamp(),
            }))
          );
        } catch (expErr) {
          console.warn('Failed to save to expenses collection:', expErr);
        }
      }

      // 2. Post-Entry for Pending Purchase Bills (Instantly marks as paid/partially paid)
      for (const p of billPayments) {
        try {
          const pRef = doc(db, 'purchaseLogs', p.billId);
          await updateDoc(pRef, {
            paidAmount: increment(p.paymentAmount),
            netDue: increment(-p.paymentAmount),
            lastPaymentReportId: reportRef.id,
            lastPaymentDate: new Date().toISOString(),
          });
        } catch (bErr) {
          console.warn('Failed to update purchase bill settlement:', bErr);
        }
      }

      // 3. Create Transactions to update Finance Manager balances
      const common = {
        businessId: selectedBusiness.id,
        ownerId: selectedBusiness.ownerId,
        branchId: selectedBranch?.id || 'global',
        serviceId: selectedService?.id || 'global',
        userId: auth.currentUser.uid,
        date: new Date().toISOString(),
        createdAt: serverTimestamp(),
        isFromReport: true,
      };

      const transactions: Partial<Transaction>[] = [];

      if (cashSale > 0) {
        transactions.push({ ...common, type: 'income', amount: cashSale, toAccount: 'cash', category: 'Daily Cash Sale', description: `Report: ${format(new Date(), 'MMM dd')}` });
      }
      if (onlineSale > 0) {
        transactions.push({ ...common, type: 'income', amount: onlineSale, toAccount: 'bank', toBankId: selectedBankId, category: 'Daily Online / Gateway Sale', description: `Online Sale: ${format(new Date(), 'MMM dd')}` });
      }
      if (cardSale > 0) {
        const effectiveCardBankId = cardBankId || selectedBankId;
        transactions.push({ ...common, type: 'income', amount: cardSale, toAccount: 'bank', toBankId: effectiveCardBankId, category: 'Daily Card / POS Machine Sale', description: `Card Machine Sale: ${format(new Date(), 'MMM dd')}` });
      }
      if (onlineSale === 0 && cardSale === 0 && Number(formData.bankSale) > 0) {
        transactions.push({ ...common, type: 'income', amount: Number(formData.bankSale), toAccount: 'bank', toBankId: selectedBankId, category: 'Daily Bank Sale', description: `Report Bank Sales: ${format(new Date(), 'MMM dd')}` });
      }
      if (formData.cashExpense > 0) {
        transactions.push({ ...common, type: 'expense', amount: formData.cashExpense, fromAccount: 'cash', category: 'Daily Cash Expense', description: `Report: ${format(new Date(), 'MMM dd')}` });
      }
      
      // Handle itemized bank expenses vs direct entry
      if (expenseItems.length > 0) {
        expenseItems.forEach(exp => {
          if (exp.paymentType === 'bank' && exp.amount > 0) {
            transactions.push({
              ...common,
              type: 'expense',
              amount: exp.amount,
              fromAccount: 'bank',
              fromBankId: exp.bankId || selectedBankId,
              category: exp.category,
              description: exp.note || `Itemized Expense (${exp.bankName || 'Bank'})`
            });
          }
        });
      } else if (formData.bankExpense > 0) {
        transactions.push({ ...common, type: 'expense', amount: formData.bankExpense, fromAccount: 'bank', fromBankId: selectedBankId, category: 'Daily Bank Expense', description: `Report: ${format(new Date(), 'MMM dd')}` });
      }

      // Bank to Cash (Withdrawals) - Support for multiple rows
      for (const row of bankToCashRows) {
        const amt = Number(row.amount) || 0;
        if (amt > 0) {
          const effectiveBankId = row.bankId || selectedBankId;
          transactions.push({
            ...common,
            type: 'transfer',
            amount: amt,
            fromAccount: 'bank',
            toAccount: 'cash',
            fromBankId: effectiveBankId,
            category: 'Bank to Cash Withdrawal',
            description: `Cash withdrawal from ${branchBankAccounts.find(b => b.id === effectiveBankId)?.bankName || 'Bank'}`,
          });
        }
      }

      // Cash to Bank (Deposits) - Support for multiple rows
      for (const row of cashToBankRows) {
        const amt = Number(row.amount) || 0;
        if (amt > 0) {
          const effectiveBankId = row.bankId || selectedBankId;
          transactions.push({
            ...common,
            type: 'transfer',
            amount: amt,
            fromAccount: 'cash',
            toAccount: 'bank',
            toBankId: effectiveBankId,
            category: 'Cash to Bank Deposit',
            description: `Cash deposit into ${branchBankAccounts.find(b => b.id === effectiveBankId)?.bankName || 'Bank'}`,
          });
        }
      }

      // Bank to Bank (Transfers) - Support for multiple rows
      for (const row of bankToBankRows) {
        const amt = Number(row.amount) || 0;
        if (amt > 0 && row.fromBankId && row.toBankId && row.fromBankId !== row.toBankId) {
          transactions.push({
            ...common,
            type: 'transfer',
            amount: amt,
            fromAccount: 'bank',
            toAccount: 'bank',
            fromBankId: row.fromBankId,
            toBankId: row.toBankId,
            category: 'Bank to Bank Transfer',
            description: `Transfer from ${branchBankAccounts.find(b => b.id === row.fromBankId)?.bankName || 'Bank'} to ${branchBankAccounts.find(b => b.id === row.toBankId)?.bankName || 'Bank'}`,
          });
        }
      }

      // Pending Purchase Bill Payments
      for (const p of billPayments) {
        transactions.push({
          ...common,
          type: 'expense',
          amount: p.paymentAmount,
          fromAccount: p.paymentMode,
          fromBankId: p.paymentMode === 'bank' ? (p.bankId || selectedBankId) : undefined,
          category: 'Accounts Payable Payment (Supplier)',
          description: `Paid Bill #${p.invoiceNumber} to ${p.supplierName}`,
        });
      }

      // Save all transactions
      await Promise.all(transactions.map(t => addDoc(collection(db, 'transactions'), t)));

      // 4. Update Bank Balances precisely without conflicts
      // Online / Gateway Sale routes directly to configured Online/Default bank account
      if (onlineSale > 0 && selectedBankId) {
        await updateDoc(doc(db, 'bankAccounts', selectedBankId), { balance: increment(onlineSale) });
      }

      // Card Machine Sale routes directly to configured Card Settlement bank account
      if (cardSale > 0) {
        const effectiveCardBankId = cardBankId || selectedBankId;
        if (effectiveCardBankId) {
          await updateDoc(doc(db, 'bankAccounts', effectiveCardBankId), { balance: increment(cardSale) });
        }
      }

      // Fallback for legacy direct bank sale entry
      if (onlineSale === 0 && cardSale === 0 && Number(formData.bankSale) > 0 && selectedBankId) {
        await updateDoc(doc(db, 'bankAccounts', selectedBankId), { balance: increment(Number(formData.bankSale)) });
      }

      // Bank Expenses
      if (expenseItems.length > 0) {
        for (const exp of expenseItems) {
          if (exp.paymentType === 'bank' && exp.amount > 0 && exp.bankId) {
            await updateDoc(doc(db, 'bankAccounts', exp.bankId), { balance: increment(-exp.amount) });
          }
        }
      } else if (formData.bankExpense > 0 && selectedBankId) {
        await updateDoc(doc(db, 'bankAccounts', selectedBankId), { balance: increment(-formData.bankExpense) });
      }

      // Bank to Cash withdrawals (deduct from each row's selected bank)
      for (const row of bankToCashRows) {
        const amt = Number(row.amount) || 0;
        const bId = row.bankId || selectedBankId;
        if (amt > 0 && bId) {
          await updateDoc(doc(db, 'bankAccounts', bId), { balance: increment(-amt) });
        }
      }

      // Cash to Bank deposits (credit to each row's selected bank)
      for (const row of cashToBankRows) {
        const amt = Number(row.amount) || 0;
        const bId = row.bankId || selectedBankId;
        if (amt > 0 && bId) {
          await updateDoc(doc(db, 'bankAccounts', bId), { balance: increment(amt) });
        }
      }

      // Bank to Bank adjustments (debit fromBankId, credit toBankId)
      for (const row of bankToBankRows) {
        const amt = Number(row.amount) || 0;
        if (amt > 0 && row.fromBankId && row.toBankId && row.fromBankId !== row.toBankId) {
          await updateDoc(doc(db, 'bankAccounts', row.fromBankId), { balance: increment(-amt) });
          await updateDoc(doc(db, 'bankAccounts', row.toBankId), { balance: increment(amt) });
        }
      }

      // Pending bill payments via bank & update Supplier Due
      for (const p of billPayments) {
        if (p.paymentMode === 'bank' && p.bankId) {
          await updateDoc(doc(db, 'bankAccounts', p.bankId), { balance: increment(-p.paymentAmount) });
        }
        // Also update the supplier's due balance in Firestore
        try {
          const billSnap = await getDoc(doc(db, 'purchaseLogs', p.billId));
          if (billSnap.exists()) {
            const billData = billSnap.data();
            if (billData.supplierId) {
              await updateDoc(doc(db, 'suppliers', billData.supplierId), {
                totalDue: increment(-p.paymentAmount)
              });
            }
          }
        } catch (suppErr) {
          console.warn('Supplier balance sync notice:', suppErr);
        }
      }

      toast.success('Report submitted and balances updated successfully!');
      setClosingReportToView({ id: reportRef.id, ...report });
      setFormData({
        openingCash: closingCash,
        openingBank: closingBank,
        cashSale: 0,
        onlineSale: 0,
        cardSale: 0,
        bankSale: 0,
        cashExpense: 0,
        bankExpense: 0,
        note: '',
      });
      setExpenseItems([]);
      setBillPayments([]);
      setCashToBankRows([{ id: `c2b_${Date.now()}`, amount: 0, bankId: selectedBankId || branchBankAccounts[0]?.id || '' }]);
      setBankToCashRows([{ id: `b2c_${Date.now()}`, amount: 0, bankId: selectedBankId || branchBankAccounts[0]?.id || '' }]);
      setBankToBankRows([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'dailyReports');
      toast.error('Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  const [deleteLoading, setDeleteLoading] = useState(false);

  // Admin Delete Daily Report (Safe In-App Action)
  const handleDeleteReport = (report: DailyReport) => {
    if (!isAdmin) {
      toast.error('Only administrators can delete daily reports');
      return;
    }
    setReportToDelete(report);
  };

  const executeDeleteReport = async (report: DailyReport) => {
    if (!report.id || !isAdmin) return;
    setDeleteLoading(true);
    try {
      // 1. Delete document from 'dailyReports' collection
      await deleteDoc(doc(db, 'dailyReports', report.id));

      // 2. Delete any itemized expenses stored under this report in 'expenses' collection
      try {
        const expQ = query(
          collection(db, 'expenses'),
          where('reportId', '==', report.id)
        );
        const expSnap = await getDocs(expQ);
        await Promise.all(expSnap.docs.map(d => deleteDoc(doc(db, 'expenses', d.id))));
      } catch (expErr) {
        console.warn('Expense cleanup warning:', expErr);
      }

      // 3. Reverse bank balance if applicable
      const bankNetChange = (Number(report.bankSale) || 0) + (Number(report.cashToBank) || 0) - (Number(report.bankExpense) || 0) - (Number(report.bankToCash) || 0);
      if (bankNetChange !== 0 && selectedBankId) {
        try {
          await updateDoc(doc(db, 'bankAccounts', selectedBankId), {
            balance: increment(-bankNetChange)
          });
        } catch (bErr) {
          console.warn('Bank reverse warning:', bErr);
        }
      }

      // 4. Delete related transactions created from report
      try {
        const transQ = query(
          collection(db, 'transactions'),
          where('businessId', '==', report.businessId),
          where('isFromReport', '==', true)
        );
        const transSnap = await getDocs(transQ);
        const repDateStr = report.date?.slice(0, 10);
        const toDelete = transSnap.docs.filter(d => {
          const t = d.data();
          return t.date && t.date.slice(0, 10) === repDateStr;
        });
        await Promise.all(toDelete.map(d => deleteDoc(doc(db, 'transactions', d.id))));
      } catch (tErr) {
        console.warn('Transactions cleanup warning:', tErr);
      }

      toast.success('Daily report deleted and balances reversed successfully');
      setReportToDelete(null);
      if (selectedReport?.id === report.id) {
        setSelectedReport(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'dailyReports');
      toast.error('Failed to delete report from database');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Admin Start Editing Daily Report
  const handleStartEdit = (report: DailyReport) => {
    if (!isAdmin) {
      toast.error('Only administrators can edit daily reports');
      return;
    }

    setEditingReport(report);
    let dateStr = '';
    try {
      dateStr = report.date ? format(new Date(report.date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
    } catch {
      dateStr = format(new Date(), 'yyyy-MM-dd');
    }

    setEditFormData({
      date: dateStr,
      openingCash: report.openingCash || 0,
      openingBank: report.openingBank || 0,
      cashSale: report.cashSale || 0,
      onlineSale: report.onlineSale || 0,
      cardSale: report.cardSale || 0,
      bankSale: report.bankSale || 0,
      cashExpense: report.cashExpense || 0,
      bankExpense: report.bankExpense || 0,
      bankToCash: report.bankToCash || 0,
      cashToBank: report.cashToBank || 0,
      note: report.note || '',
    });
  };

  const editElectronicSales = (Number(editFormData.cardSale) > 0 || Number(editFormData.onlineSale) > 0)
    ? (Number(editFormData.cardSale) + Number(editFormData.onlineSale))
    : Number(editFormData.bankSale);
  const editClosingCash = editFormData.openingCash + editFormData.cashSale + editFormData.bankToCash - editFormData.cashExpense - editFormData.cashToBank;
  const editClosingBank = editFormData.openingBank + editElectronicSales + editFormData.cashToBank - editFormData.bankExpense - editFormData.bankToCash;

  // Admin Save Edited Report
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReport?.id || !isAdmin) return;

    setEditSaving(true);
    try {
      const updatedFields = {
        date: new Date(editFormData.date).toISOString(),
        openingCash: Number(editFormData.openingCash) || 0,
        openingBank: Number(editFormData.openingBank) || 0,
        cashSale: Number(editFormData.cashSale) || 0,
        bankSale: Number(editFormData.bankSale) || 0,
        cashExpense: Number(editFormData.cashExpense) || 0,
        bankExpense: Number(editFormData.bankExpense) || 0,
        bankToCash: Number(editFormData.bankToCash) || 0,
        cashToBank: Number(editFormData.cashToBank) || 0,
        closingCash: editClosingCash,
        closingBank: editClosingBank,
        note: editFormData.note || '',
      };

      await updateDoc(doc(db, 'dailyReports', editingReport.id), updatedFields);
      toast.success('Daily report updated successfully');

      // Update selected report if open in viewer
      if (selectedReport?.id === editingReport.id) {
        setSelectedReport({
          ...selectedReport,
          ...updatedFields,
        });
      }

      setEditingReport(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'dailyReports');
      toast.error('Failed to update daily report');
    } finally {
      setEditSaving(false);
    }
  };

  // Pure Vector PDF Download Handler (No window.print or popup blockers)
  const handlePrintReport = (report: DailyReport) => {
    generateDailyReportPdf({
      report,
      business: selectedBusiness,
      branch: selectedBranch,
      currency,
    });
  };

  // Filtered & Paginated Reports
  const filteredReports = reports.filter(report => {
    if (!dateFilter) return true;
    try {
      const reportDateStr = format(new Date(report.date), 'yyyy-MM-dd');
      return reportDateStr === dateFilter;
    } catch {
      return false;
    }
  });

  const totalPages = Math.ceil(filteredReports.length / PAGE_SIZE) || 1;
  const paginatedReports = filteredReports.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Column: Daily Report Form */}
      <div className="space-y-6">
        {!selectedBranch && !selectedService ? (
          <div className="bg-[#1E293B] p-12 rounded-3xl border border-slate-800 shadow-xl text-center space-y-5">
            <div className="bg-slate-900 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-blue-500">
              <FileText size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-slate-200 font-black text-lg uppercase tracking-widest">Select a Branch or Service</p>
              <p className="text-slate-500 text-sm font-bold">Please select a specific branch or digital service from the top menu to submit daily reports.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsStatementOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-2xl text-xs font-black transition-all shadow-lg shadow-blue-900/30 active:scale-95"
            >
              <FileSpreadsheet size={16} />
              <span>Open Monthly Statement</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 text-blue-500 mb-2">
                <div className="flex items-center gap-3">
                  <FileText size={24} />
                  <h2 className="text-lg font-black uppercase tracking-widest">Daily Report</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsStatementOpen(true)}
                    className="px-3.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 active:scale-95"
                  >
                    <FileSpreadsheet size={15} />
                    <span>Monthly Statement</span>
                  </button>
                  {isAdmin && (
                    <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-400 px-2.5 py-1 rounded-lg border border-amber-500/20">
                      Admin Access
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <InputGroup label="Opening Cash" value={formData.openingCash} readOnly icon={<Wallet size={16} />} />
                <InputGroup label="Opening Bank" value={formData.openingBank} readOnly icon={<Landmark size={16} />} />
              </div>

              {branchBankAccounts.length > 0 && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Select Branch Bank Account</label>
                  <select
                    value={selectedBankId}
                    onChange={(e) => setSelectedBankId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500"
                  >
                    {branchBankAccounts.map(bank => (
                      <option key={bank.id} value={bank.id}>{bank.bankName} - {bank.accountName}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Receipt size={14} className="text-emerald-400" /> Sales Revenue
                  </span>
                  <button
                    type="button"
                    onClick={handleImportSalesPlayTodaySales}
                    disabled={isImportingSalesPlay}
                    className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                    title="Import today's live sales from SalesPlay POS"
                  >
                    <RefreshCw size={12} className={cn(isImportingSalesPlay && "animate-spin")} />
                    <span>{isImportingSalesPlay ? 'Importing...' : '⚡ Import Today from SalesPlay'}</span>
                  </button>
                </div>
                {/* 3 Distinct Sales Input Channels (Cash, Online, Card) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 1. CASH SALE (+) */}
                  <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 space-y-2">
                    <InputGroup
                      label="CASH SALE (+)"
                      value={formData.cashSale}
                      onChange={(v) => setFormData({ ...formData, cashSale: v })}
                      icon={<Wallet size={16} className="text-emerald-400" />}
                      step="0.001"
                    />
                    <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 font-bold">
                      <span className="text-emerald-400">💵 Physical Cash</span>
                      <span>Direct to Closing Cash</span>
                    </div>
                  </div>

                  {/* 2. ONLINE SALE (+) */}
                  <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 space-y-2">
                    <InputGroup
                      label="ONLINE SALE (+)"
                      value={formData.onlineSale}
                      onChange={(v) => {
                        const val = Number(v) || 0;
                        setFormData(prev => ({
                          ...prev,
                          onlineSale: val,
                          bankSale: toStrictDecimal3(val + (Number(prev.cardSale) || 0)),
                        }));
                      }}
                      icon={<Globe size={16} className="text-blue-400" />}
                      step="0.001"
                    />
                    <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 font-bold">
                      <span className="text-blue-400">🌐 Gateway / Wire</span>
                      <span className="truncate max-w-[120px]" title={branchBankAccounts.find(b => b.id === selectedBankId)?.bankName || 'Default Bank'}>
                        {branchBankAccounts.find(b => b.id === selectedBankId)?.bankName || 'Default Bank'}
                      </span>
                    </div>
                  </div>

                  {/* 3. CARD SALE (+) */}
                  <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 space-y-2">
                    <InputGroup
                      label="CARD SALE (+)"
                      value={formData.cardSale}
                      onChange={(v) => {
                        const val = Number(v) || 0;
                        setFormData(prev => ({
                          ...prev,
                          cardSale: val,
                          bankSale: toStrictDecimal3(val + (Number(prev.onlineSale) || 0)),
                        }));
                      }}
                      icon={<CreditCard size={16} className="text-indigo-400" />}
                      step="0.001"
                    />
                    <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 font-bold">
                      <span className="text-indigo-400">💳 Card POS Terminal</span>
                      <span className="truncate max-w-[120px]" title={branchBankAccounts.find(b => b.id === (cardBankId || selectedBankId))?.bankName || 'Card Bank'}>
                        {branchBankAccounts.find(b => b.id === (cardBankId || selectedBankId))?.bankName || 'Card Bank'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Machine Settlement Account Selector if multiple bank accounts exist */}
                {branchBankAccounts.length > 1 && (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs">
                    <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                      <CreditCard size={14} className="text-indigo-400" />
                      Card Machine Settlement Bank:
                    </span>
                    <select
                      value={cardBankId || selectedBankId}
                      onChange={(e) => setCardBankId(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white font-bold outline-none focus:border-indigo-500"
                    >
                      {branchBankAccounts.map(b => (
                        <option key={b.id} value={b.id}>{b.bankName} - {b.accountName}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Total Sales Summary Live Badge */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-950/30 border border-emerald-500/20 rounded-xl text-xs">
                  <span className="font-bold text-slate-300">
                    Total Sales Revenue (Cash + Online + Card):
                  </span>
                  <span className="font-mono font-black text-emerald-400 text-sm">
                    {currency} {formatAmount(totalSalesRevenue, currency)}
                  </span>
                </div>
              </div>

              {/* Today's Purchase Bills Ready for Daily Report Expenses */}
              {todayPurchaseBills.length > 0 && (
                <div className="bg-indigo-950/40 p-4 rounded-2xl border border-indigo-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
                      <ShoppingCart size={18} />
                    </div>
                    <div>
                      <p className="text-xs font-black text-indigo-200 uppercase tracking-wide">
                        Today's Purchase Bills Ready ({todayPurchaseBills.length})
                      </p>
                      <p className="text-[11px] text-indigo-400 font-medium">
                        Total {currency} {formatAmount(todayPurchaseBills.reduce((s, b) => s + (Number(b.paidAmount) || Number(b.billAmount) || 0), 0), currency)} ready to add as daily report expenses
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsExpenseModalOpen(true)}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-2 px-3.5 rounded-xl shadow cursor-pointer transition-all active:scale-95 whitespace-nowrap self-start sm:self-auto"
                  >
                    <Plus size={14} />
                    <span>Add to Expenses</span>
                  </button>
                </div>
              )}

              {/* ---------------------------------------------------- */}
              {/* PENDING PURCHASE BILLS (ACCOUNTS PAYABLE) SECTION     */}
              {/* ---------------------------------------------------- */}
              <div className="bg-slate-900/90 p-5 rounded-2xl border border-indigo-500/30 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-500/10 text-indigo-400 rounded-lg">
                      <ShoppingCart size={16} />
                    </div>
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-white">
                        Pending Purchase Bills (Accounts Payable)
                      </h3>
                      <p className="text-[10px] text-slate-400 font-bold">
                        Pay pending bills directly from Daily Report • Deducts from Cash/Bank • Safeguarded from P&L double deduction
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-black font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                    {pendingBills.length} Pending
                  </span>
                </div>

                {pendingBills.length === 0 ? (
                  <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-center">
                    <p className="text-xs text-slate-500 font-medium">
                      No pending purchase bills due for payment in this branch.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      {/* Bill Dropdown */}
                      <div className="sm:col-span-6">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                          Select Pending Bill
                        </label>
                        <select
                          value={selectedPendingBillId}
                          onChange={(e) => handleSelectPendingBill(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-bold outline-none focus:border-indigo-500"
                        >
                          <option value="">-- Choose Pending Bill --</option>
                          {pendingBills.map(b => {
                            const bAmt = Number(b.billAmount) || 0;
                            const pAmt = Number(b.paidAmount) || 0;
                            const due = b.netDue !== undefined && b.netDue !== null ? Number(b.netDue) : (bAmt - pAmt);
                            return (
                              <option key={b.id} value={b.id}>
                                #{b.invoiceNumber || 'INV'} • {b.supplierName} • Due: {currency} {formatAmount(due, currency)}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Payment Amount */}
                      <div className="sm:col-span-3">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                          Payment ({currency})
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={pendingPaymentAmount === 0 ? '' : pendingPaymentAmount}
                          onChange={(e) => setPendingPaymentAmount(parseFloat(e.target.value) || 0)}
                          placeholder="0.000"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs font-mono font-black text-rose-400 outline-none focus:border-indigo-500 text-right"
                        />
                      </div>

                      {/* Payment Mode */}
                      <div className="sm:col-span-3">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                          Pay Via
                        </label>
                        <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                          <button
                            type="button"
                            onClick={() => setPendingPaymentMode('cash')}
                            className={cn(
                              "py-1.5 text-[10px] font-black uppercase rounded-lg transition-all",
                              pendingPaymentMode === 'cash' ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
                            )}
                          >
                            Cash
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingPaymentMode('bank')}
                            className={cn(
                              "py-1.5 text-[10px] font-black uppercase rounded-lg transition-all",
                              pendingPaymentMode === 'bank' ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                            )}
                          >
                            Bank
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Bank selector if bank mode */}
                    {pendingPaymentMode === 'bank' && branchBankAccounts.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">
                          Deduct from Bank Account:
                        </label>
                        <select
                          value={pendingPaymentBankId || selectedBankId}
                          onChange={(e) => setPendingPaymentBankId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-white font-bold outline-none focus:border-blue-500"
                        >
                          {branchBankAccounts.map(b => (
                            <option key={b.id} value={b.id}>
                              {b.bankName} - {b.accountName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleAddBillPayment}
                      disabled={!selectedPendingBillId || pendingPaymentAmount <= 0}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer shadow-md shadow-indigo-900/30"
                    >
                      <Plus size={14} />
                      <span>+ Add Purchase Bill Settlement to Today's Report</span>
                    </button>
                  </div>
                )}

                {/* List of Added Pending Bill Payments for this Daily Report */}
                {billPayments.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                      Settlements to be Processed Today ({billPayments.length}):
                    </span>
                    <div className="space-y-1.5">
                      {billPayments.map((p) => (
                        <div
                          key={p.billId}
                          className="flex items-center justify-between p-2.5 bg-slate-950/70 border border-indigo-500/20 rounded-xl text-xs"
                        >
                          <div className="space-y-0.5">
                            <span className="font-bold text-white">Bill #{p.invoiceNumber} - {p.supplierName}</span>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                              <span className="capitalize font-bold text-indigo-300">Via {p.paymentMode}</span>
                              {p.bankName && <span>({p.bankName})</span>}
                              <span>• Remaining Due: {currency} {formatAmount(p.remainingDue, currency)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-black font-mono text-rose-400">
                              -{currency} {formatAmount(p.paymentAmount, currency)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveBillPayment(p.billId)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors"
                              title="Remove settlement"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Expenses Breakdown Header with Button */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Receipt size={14} /> Expenses Management
                    {expenseItems.length > 0 && (
                      <span className="bg-rose-500/20 text-rose-300 text-[10px] px-2 py-0.5 rounded-full font-mono">
                        {expenseItems.length} itemized
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsExpenseModalOpen(true)}
                    className="flex items-center gap-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-bold py-1.5 px-3 rounded-xl transition-all cursor-pointer active:scale-95"
                  >
                    <Plus size={13} />
                    <span>+ Itemized Breakdown</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <InputGroup
                    label="Cash Exp (-)"
                    value={formData.cashExpense}
                    onChange={(v) => setFormData({ ...formData, cashExpense: v })}
                    icon={<Calculator size={16} />}
                  />
                  <InputGroup
                    label="Bank Exp (-)"
                    value={formData.bankExpense}
                    onChange={(v) => setFormData({ ...formData, bankExpense: v })}
                    icon={<Calculator size={16} />}
                  />
                </div>

                {/* Dynamic Multi-Transaction Transfers: Cash <-> Bank & Bank to Bank */}
                <div className="space-y-4 pt-2">
                  {/* 1. BANK TO CASH (WITHDRAWAL) - Multi-Entry Rows */}
                  <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                          <ArrowRightLeft size={14} /> Bank to Cash (Withdrawal)
                        </span>
                        <p className="text-[10px] text-slate-400">Withdraw funds from bank into cash drawer</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-mono font-bold text-amber-400">
                          Total: {currency} {formatAmount(totalBankToCash, currency)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {bankToCashRows.map((row, idx) => (
                        <div key={row.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80">
                          <div className="flex-1 flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-500 w-5 text-center">#{idx + 1}</span>
                            <div className="flex-1">
                              <label className="text-[9px] font-bold text-slate-400 block mb-0.5 sm:hidden">Withdraw Amount ({currency})</label>
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                placeholder="0.000"
                                value={row.amount === 0 ? '' : row.amount}
                                onChange={(e) => handleUpdateBankToCashRow(row.id, 'amount', parseFloat(e.target.value) || 0)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-amber-300 outline-none focus:border-amber-500 text-right"
                              />
                            </div>
                          </div>
                          <div className="flex-1 flex items-center gap-2">
                            <div className="flex-1">
                              <label className="text-[9px] font-bold text-slate-400 block mb-0.5 sm:hidden">From Bank Account</label>
                              <select
                                value={row.bankId || selectedBankId}
                                onChange={(e) => handleUpdateBankToCashRow(row.id, 'bankId', e.target.value)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold outline-none focus:border-amber-500"
                              >
                                {branchBankAccounts.map(b => (
                                  <option key={b.id} value={b.id}>{b.bankName} - {b.accountName}</option>
                                ))}
                              </select>
                            </div>
                            {bankToCashRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveBankToCashRow(row.id)}
                                className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                                title="Remove entry"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleAddBankToCashRow}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg border border-amber-500/30 transition-all cursor-pointer"
                    >
                      <Plus size={13} /> Add Another Withdrawal
                    </button>
                  </div>

                  {/* 2. CASH TO BANK (DEPOSIT) - Multi-Entry Rows */}
                  <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          <ArrowRightLeft size={14} /> Cash to Bank (Deposit)
                        </span>
                        <p className="text-[10px] text-slate-400">Deposit physical cash into bank account</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-mono font-bold text-emerald-400">
                          Total: {currency} {formatAmount(totalCashToBank, currency)}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {cashToBankRows.map((row, idx) => (
                        <div key={row.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80">
                          <div className="flex-1 flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-500 w-5 text-center">#{idx + 1}</span>
                            <div className="flex-1">
                              <label className="text-[9px] font-bold text-slate-400 block mb-0.5 sm:hidden">Deposit Amount ({currency})</label>
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                placeholder="0.000"
                                value={row.amount === 0 ? '' : row.amount}
                                onChange={(e) => handleUpdateCashToBankRow(row.id, 'amount', parseFloat(e.target.value) || 0)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-emerald-300 outline-none focus:border-emerald-500 text-right"
                              />
                            </div>
                          </div>
                          <div className="flex-1 flex items-center gap-2">
                            <div className="flex-1">
                              <label className="text-[9px] font-bold text-slate-400 block mb-0.5 sm:hidden">Deposit Into Bank</label>
                              <select
                                value={row.bankId || selectedBankId}
                                onChange={(e) => handleUpdateCashToBankRow(row.id, 'bankId', e.target.value)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold outline-none focus:border-emerald-500"
                              >
                                {branchBankAccounts.map(b => (
                                  <option key={b.id} value={b.id}>{b.bankName} - {b.accountName}</option>
                                ))}
                              </select>
                            </div>
                            {cashToBankRows.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCashToBankRow(row.id)}
                                className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                                title="Remove entry"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleAddCashToBankRow}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg border border-emerald-500/30 transition-all cursor-pointer"
                    >
                      <Plus size={13} /> Add Another Deposit
                    </button>
                  </div>

                  {/* 3. BANK TO BANK (TRANSFER) - Multi-Entry Rows */}
                  <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-black text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                          <ArrowRightLeft size={14} /> Bank to Bank (Transfer)
                        </span>
                        <p className="text-[10px] text-slate-400">Inter-bank transfer between branch accounts</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-mono font-bold text-blue-400">
                          Total: {currency} {formatAmount(totalBankToBank, currency)}
                        </span>
                      </div>
                    </div>

                    {bankToBankRows.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic py-1">
                        No bank-to-bank transfers added today. Click below to add an inter-bank transfer if funds were moved between accounts.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {bankToBankRows.map((row, idx) => (
                          <div key={row.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 items-center">
                            <div className="sm:col-span-4">
                              <label className="text-[9px] font-bold text-slate-400 block mb-0.5 sm:hidden">Transfer Amount ({currency})</label>
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                placeholder="0.000"
                                value={row.amount === 0 ? '' : row.amount}
                                onChange={(e) => handleUpdateBankToBankRow(row.id, 'amount', parseFloat(e.target.value) || 0)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-blue-400 outline-none focus:border-blue-500 text-right"
                              />
                            </div>
                            <div className="sm:col-span-4">
                              <label className="text-[9px] font-bold text-slate-400 block mb-0.5 sm:hidden">From Bank</label>
                              <select
                                value={row.fromBankId}
                                onChange={(e) => handleUpdateBankToBankRow(row.id, 'fromBankId', e.target.value)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold outline-none focus:border-blue-500"
                              >
                                {branchBankAccounts.map(b => (
                                  <option key={b.id} value={b.id}>{b.bankName} - {b.accountName}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[9px] font-bold text-slate-400 block mb-0.5 sm:hidden">To Bank</label>
                              <select
                                value={row.toBankId}
                                onChange={(e) => handleUpdateBankToBankRow(row.id, 'toBankId', e.target.value)}
                                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-bold outline-none focus:border-blue-500"
                              >
                                {branchBankAccounts.map(b => (
                                  <option key={b.id} value={b.id}>{b.bankName} - {b.accountName}</option>
                                ))}
                              </select>
                            </div>
                            <div className="sm:col-span-1 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveBankToBankRow(row.id)}
                                className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                                title="Remove transfer"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleAddBankToBankRow}
                      className="flex items-center gap-1.5 text-[11px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg border border-blue-500/30 transition-all cursor-pointer"
                    >
                      <Plus size={13} /> Add Inter-Bank Transfer
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Closing Cash</span>
                    <Link to="/cash-count" className="text-[10px] font-black text-blue-500 hover:text-blue-400 flex items-center gap-1 mt-1">
                      <Banknote size={12} /> Count Cash
                    </Link>
                  </div>
                  <span className="text-lg font-black font-mono text-emerald-400">{currency} {formatAmount(closingCash, currency)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Closing Bank</span>
                  <span className="text-lg font-black font-mono text-blue-400">{currency} {formatAmount(closingBank, currency)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Manager Note</label>
                <textarea
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  maxLength={1000}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm focus:border-blue-500 outline-none transition-all h-24 resize-none"
                  placeholder="Any special notes for today?"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
              >
                {loading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div> : <Save size={20} />}
                Submit Daily Report
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Right Column: Report History with Date Filter & Pagination */}
      <div className="space-y-6">
        <div className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-slate-300">
              <History size={20} className="text-blue-500" />
              <h3 className="text-xs font-black uppercase tracking-[0.2em]">Report History {!selectedBranch && !selectedService && '(All Entities)'}</h3>
            </div>
            <div className="flex items-center gap-2">
              {reports.length > 0 && (
                <button
                  type="button"
                  onClick={() => setClosingReportToView(reports[0])}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-900/20 active:scale-95 cursor-pointer"
                  title="Open 1-Page End of Day Daily Closing Statement"
                >
                  <Receipt size={14} />
                  <span>Closing Statement (Z-Report)</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsStatementOpen(true)}
                className="px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-lg shadow-blue-900/20 active:scale-95 cursor-pointer"
                title="Date-to-Date Financial Statement in Bank format"
              >
                <Calendar size={14} />
                <span>Date-to-Date Statement</span>
              </button>
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                {filteredReports.length} {filteredReports.length === 1 ? 'Report' : 'Reports'}
              </span>
            </div>
          </div>

          {/* Calendar Date Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-slate-900/80 p-3 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-blue-400 shrink-0" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filter by Date:</span>
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="date" 
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="bg-slate-800/90 border border-slate-700 text-white text-xs font-bold rounded-xl px-3 py-1.5 outline-none focus:border-blue-500 transition-colors"
              />
              {dateFilter && (
                <button 
                  onClick={() => setDateFilter('')}
                  className="px-2 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl text-xs font-bold transition-colors flex items-center gap-1"
                  title="Clear Date Filter"
                >
                  <X size={13} />
                  <span className="text-[10px] uppercase font-black">Clear</span>
                </button>
              )}
            </div>
          </div>

          {/* History List */}
          <div className="space-y-3">
            {paginatedReports.map(report => (
              <div key={report.id} className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-3 group hover:border-blue-500/30 transition-all">
                <div className="flex justify-between items-center gap-2">
                  <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <Calendar size={12} className="text-slate-500" />
                    {report.date ? format(new Date(report.date), 'MMM dd, yyyy') : 'No Date'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* View Eye Button */}
                    <button 
                      onClick={() => setSelectedReport(report)}
                      className="p-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-colors cursor-pointer"
                      title="View & Print Report"
                    >
                      <Eye size={15} />
                    </button>

                    {/* Daily Closing Statement 1-Page Z-Report */}
                    <button 
                      onClick={() => setClosingReportToView(report)}
                      className="p-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors flex items-center gap-1 text-[10px] font-bold cursor-pointer"
                      title="View 1-Page Daily Closing Statement (Z-Report)"
                    >
                      <Receipt size={14} />
                      <span className="hidden sm:inline">Closing Statement</span>
                    </button>

                    {/* Admin Edit Button */}
                    {isAdmin && (
                      <button 
                        onClick={() => handleStartEdit(report)}
                        className="p-1.5 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg transition-colors"
                        title="Admin: Edit Report"
                      >
                        <Edit2 size={15} />
                      </button>
                    )}

                    {/* Admin Delete Button */}
                    {isAdmin && (
                      <button 
                        onClick={() => handleDeleteReport(report)}
                        className="p-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-lg transition-colors"
                        title="Admin: Delete Report"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}

                    <span className="text-[10px] font-black bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-md uppercase ml-1">
                      {report.branchId !== 'global' 
                        ? (branches.find(b => b.id === report.branchId)?.name || 'Branch')
                        : (services.find(s => s.id === report.serviceId)?.name || 'Service')
                      }
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Closing Cash</p>
                    <p className="text-sm font-black font-mono text-emerald-400">{currency} {formatAmount(report.closingCash || 0, currency)}</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-black text-slate-600 uppercase tracking-widest">Closing Bank</p>
                    <p className="text-sm font-black font-mono text-blue-400">{currency} {formatAmount(report.closingBank || 0, currency)}</p>
                  </div>
                </div>

                {((Number(report.cashToBank) || 0) > 0 || (Number(report.bankToCash) || 0) > 0) && (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-800/60">
                    {(Number(report.cashToBank) || 0) > 0 && (
                      <span className="text-[9px] font-bold font-mono px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <ArrowRightLeft size={10} /> Dep (Cash→Bank): {currency} {formatAmount(report.cashToBank || 0, currency)}
                      </span>
                    )}
                    {(Number(report.bankToCash) || 0) > 0 && (
                      <span className="text-[9px] font-bold font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <ArrowRightLeft size={10} /> W/D (Bank→Cash): {currency} {formatAmount(report.bankToCash || 0, currency)}
                      </span>
                    )}
                  </div>
                )}

                {report.note && (
                  <p className="text-[10px] text-slate-400 italic border-t border-slate-800 pt-2 line-clamp-1">"{report.note}"</p>
                )}
              </div>
            ))}

            {filteredReports.length === 0 && (
              <div className="p-12 text-center text-slate-500 font-bold uppercase tracking-widest text-[10px] bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
                {dateFilter ? `No reports found for ${dateFilter}` : 'No reports found'}
              </div>
            )}
          </div>

          {/* Pagination Controls (Last 10 per page) */}
          {filteredReports.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-800 text-xs text-slate-400">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Showing {(currentPage - 1) * PAGE_SIZE + 1} - {Math.min(currentPage * PAGE_SIZE, filteredReports.length)} of {filteredReports.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="Previous 10"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-2 text-[10px] font-black text-slate-300">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  title="Next 10"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full Report Details Modal (Eye Button) */}
      <AnimatePresence>
        {selectedReport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                <div>
                  <h2 className="text-xl font-black text-white uppercase tracking-tight">Full Daily Report</h2>
                  <p className="text-xs text-slate-500 font-bold">
                    {selectedReport.date ? format(new Date(selectedReport.date), 'EEEE, MMM dd, yyyy') : 'No Date'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Print / Save PDF in Header */}
                  <button 
                    onClick={() => handlePrintReport(selectedReport)}
                    className="p-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-xl transition-all flex items-center gap-1.5 text-xs font-black uppercase tracking-wider"
                    title="Print / Save as PDF"
                  >
                    <Printer size={16} />
                    <Download size={14} />
                    <span>Print / PDF</span>
                  </button>

                  {/* Admin actions in Modal */}
                  {isAdmin && (
                    <>
                      <button 
                        onClick={() => {
                          const rep = selectedReport;
                          setSelectedReport(null);
                          handleStartEdit(rep);
                        }}
                        className="p-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-xl transition-colors"
                        title="Admin: Edit Report"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDeleteReport(selectedReport)}
                        className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-xl transition-colors"
                        title="Admin: Delete Report"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}

                  <button 
                    onClick={() => setSelectedReport(null)}
                    className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors ml-1"
                  >
                    <Plus className="rotate-45" size={24} />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-6">
                {/* Header Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Entity</p>
                    <p className="text-sm font-bold text-blue-400">
                      {selectedReport.branchId !== 'global' 
                        ? (branches.find(b => b.id === selectedReport.branchId)?.name || 'Branch')
                        : (services.find(s => s.id === selectedReport.serviceId)?.name || 'Service')
                      }
                    </p>
                  </div>
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Submitted By</p>
                    <p className="text-sm font-bold text-white">Manager</p>
                  </div>
                </div>

                {/* Balances Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Wallet size={14} className="text-emerald-500" /> Cash Account
                    </h3>
                    <div className="space-y-2 bg-slate-900/30 p-4 rounded-2xl border border-slate-800/50">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500 font-bold">Opening Cash</span>
                        <span className="text-slate-300 font-black font-mono">{currency} {formatAmount(selectedReport.openingCash || 0, currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-emerald-500 font-bold">Cash Sales (+)</span>
                        <span className="text-emerald-400 font-black font-mono">{currency} {formatAmount(selectedReport.cashSale || 0, currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-emerald-400 font-bold">Bank to Cash / Withdrawal (+)</span>
                        <span className="text-emerald-400 font-black font-mono">{currency} {formatAmount(selectedReport.bankToCash || 0, currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-rose-500 font-bold">Cash Expenses (-)</span>
                        <span className="text-rose-400 font-black font-mono">{currency} {formatAmount(selectedReport.cashExpense || 0, currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-rose-400 font-bold">Cash to Bank / Deposit (-)</span>
                        <span className="text-rose-400 font-black font-mono">{currency} {formatAmount(selectedReport.cashToBank || 0, currency)}</span>
                      </div>
                      <div className="h-px bg-slate-800 my-2" />
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-200 font-black">Closing Cash</span>
                        <span className="text-emerald-400 font-black font-mono">{currency} {formatAmount(selectedReport.closingCash || 0, currency)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Landmark size={14} className="text-blue-500" /> Bank Account
                    </h3>
                    <div className="space-y-2 bg-slate-900/30 p-4 rounded-2xl border border-slate-800/50">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500 font-bold">Opening Bank</span>
                        <span className="text-slate-300 font-black font-mono">{currency} {formatAmount(selectedReport.openingBank || 0, currency)}</span>
                      </div>
                      {selectedReport.onlineSale !== undefined || selectedReport.cardSale !== undefined ? (
                        <>
                          <div className="flex justify-between text-xs">
                            <span className="text-blue-400 font-bold">Online / Wire Sales (+)</span>
                            <span className="text-blue-400 font-black font-mono">{currency} {formatAmount(selectedReport.onlineSale || 0, currency)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-indigo-400 font-bold">Card (POS) Sales (+)</span>
                            <span className="text-indigo-400 font-black font-mono">{currency} {formatAmount(selectedReport.cardSale || 0, currency)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="flex justify-between text-xs">
                          <span className="text-emerald-500 font-bold">Bank Sales (+)</span>
                          <span className="text-emerald-400 font-black font-mono">{currency} {formatAmount(selectedReport.bankSale || 0, currency)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs">
                        <span className="text-blue-400 font-bold">Cash to Bank / Deposit (+)</span>
                        <span className="text-blue-400 font-black font-mono">{currency} {formatAmount(selectedReport.cashToBank || 0, currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-rose-500 font-bold">Bank Expenses (-)</span>
                        <span className="text-rose-400 font-black font-mono">{currency} {formatAmount(selectedReport.bankExpense || 0, currency)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-rose-400 font-bold">Bank to Cash / Withdrawal (-)</span>
                        <span className="text-rose-400 font-black font-mono">{currency} {formatAmount(selectedReport.bankToCash || 0, currency)}</span>
                      </div>
                      <div className="h-px bg-slate-800 my-2" />
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-200 font-black">Closing Bank</span>
                        <span className="text-blue-400 font-black font-mono">{currency} {formatAmount(selectedReport.closingBank || 0, currency)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bank & Cash Transfers Summary Section */}
                <div className="bg-slate-900/40 p-4 rounded-2xl border border-slate-800 space-y-3">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <ArrowRightLeft size={14} className="text-blue-400" /> Bank & Cash Transfers (Deposits & Withdrawals)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Cash to Bank (Bank Deposit)</span>
                      <p className="text-lg font-black text-blue-400 mt-1">
                        {currency}{(selectedReport.cashToBank || 0).toLocaleString()}
                      </p>
                      <span className="text-[9px] text-slate-500 block mt-0.5">Cash Drawer ➔ Bank Account</span>
                    </div>
                    <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Bank to Cash (Cash Withdrawal)</span>
                      <p className="text-lg font-black text-emerald-400 mt-1">
                        {currency}{(selectedReport.bankToCash || 0).toLocaleString()}
                      </p>
                      <span className="text-[9px] text-slate-500 block mt-0.5">Bank Account ➔ Cash Drawer</span>
                    </div>
                  </div>
                </div>

                {/* Summary Card */}
                <div className="bg-blue-600 rounded-2xl p-6 shadow-xl shadow-blue-900/20 text-white">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest mb-1">Total Liquidity</p>
                      <h4 className="text-2xl font-black">{currency}{(selectedReport.closingCash + selectedReport.closingBank).toLocaleString()}</h4>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-blue-200 uppercase tracking-widest mb-1">Net Profit/Loss</p>
                      <h4 className="text-2xl font-black">
                        {currency}{(selectedReport.cashSale + selectedReport.bankSale - selectedReport.cashExpense - selectedReport.bankExpense).toLocaleString()}
                      </h4>
                    </div>
                  </div>
                </div>

                {selectedReport.note && (
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Manager Remarks</p>
                    <p className="text-sm text-slate-300 italic leading-relaxed">"{selectedReport.note}"</p>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex gap-3">
                <button
                  onClick={() => handlePrintReport(selectedReport)}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                >
                  <Printer size={18} />
                  Print / Download PDF
                </button>
                <button
                  onClick={() => setSelectedReport(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-8 py-4 rounded-2xl font-black transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Edit Modal */}
      <AnimatePresence>
        {editingReport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] border border-amber-500/30 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/10 text-amber-400 rounded-xl">
                    <Edit2 size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white uppercase tracking-tight">Admin: Edit Daily Report</h2>
                    <p className="text-xs text-slate-500 font-bold">
                      Modify report numbers and recalculate closing balances
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setEditingReport(null)}
                  className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="p-6 overflow-y-auto flex-1 space-y-6">
                {/* Date Setting */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-1.5">
                    <Calendar size={14} className="text-amber-400" />
                    Report Date
                  </label>
                  <input
                    type="date"
                    required
                    value={editFormData.date}
                    onChange={(e) => setEditFormData({ ...editFormData, date: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-bold text-white outline-none focus:border-amber-500 transition-all"
                  />
                </div>

                {/* Opening Balances */}
                <div className="grid grid-cols-2 gap-4">
                  <InputGroup
                    label="Opening Cash"
                    value={editFormData.openingCash}
                    onChange={(v) => setEditFormData({ ...editFormData, openingCash: v })}
                    icon={<Wallet size={16} className="text-amber-400" />}
                  />
                  <InputGroup
                    label="Opening Bank"
                    value={editFormData.openingBank}
                    onChange={(v) => setEditFormData({ ...editFormData, openingBank: v })}
                    icon={<Landmark size={16} className="text-amber-400" />}
                  />
                </div>

                {/* Sales (3-Way: Cash, Online, Card) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <InputGroup
                    label="Cash Sale (+)"
                    value={editFormData.cashSale}
                    onChange={(v) => setEditFormData({ ...editFormData, cashSale: v })}
                    icon={<Wallet size={16} className="text-emerald-400" />}
                  />
                  <InputGroup
                    label="Online Sale (+)"
                    value={editFormData.onlineSale}
                    onChange={(v) => {
                      const val = Number(v) || 0;
                      setEditFormData(prev => ({
                        ...prev,
                        onlineSale: val,
                        bankSale: toStrictDecimal3(val + (Number(prev.cardSale) || 0)),
                      }));
                    }}
                    icon={<Globe size={16} className="text-blue-400" />}
                  />
                  <InputGroup
                    label="Card Sale (+)"
                    value={editFormData.cardSale}
                    onChange={(v) => {
                      const val = Number(v) || 0;
                      setEditFormData(prev => ({
                        ...prev,
                        cardSale: val,
                        bankSale: toStrictDecimal3(val + (Number(prev.onlineSale) || 0)),
                      }));
                    }}
                    icon={<CreditCard size={16} className="text-indigo-400" />}
                  />
                </div>

                {/* Expenses & Transfers */}
                <div className="grid grid-cols-2 gap-4">
                  <InputGroup
                    label="Cash Exp (-)"
                    value={editFormData.cashExpense}
                    onChange={(v) => setEditFormData({ ...editFormData, cashExpense: v })}
                    icon={<Calculator size={16} />}
                  />
                  <InputGroup
                    label="Bank Exp (-)"
                    value={editFormData.bankExpense}
                    onChange={(v) => setEditFormData({ ...editFormData, bankExpense: v })}
                    icon={<Calculator size={16} />}
                  />
                  <InputGroup
                    label="Bank to Cash (Withdrawal)"
                    value={editFormData.bankToCash}
                    onChange={(v) => setEditFormData({ ...editFormData, bankToCash: v })}
                    icon={<ArrowRightLeft size={16} />}
                  />
                  <InputGroup
                    label="Cash to Bank (Deposit)"
                    value={editFormData.cashToBank}
                    onChange={(v) => setEditFormData({ ...editFormData, cashToBank: v })}
                    icon={<ArrowRightLeft size={16} />}
                  />
                </div>

                {/* Recalculated Preview */}
                <div className="bg-slate-900/70 p-5 rounded-2xl border border-amber-500/20 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recalculated Closing Cash</span>
                    <span className="text-lg font-black text-emerald-400">{currency}{editClosingCash.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recalculated Closing Bank</span>
                    <span className="text-lg font-black text-blue-400">{currency}{editClosingBank.toLocaleString()}</span>
                  </div>
                </div>

                {/* Note */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Manager Remarks / Correction Note</label>
                  <textarea
                    value={editFormData.note}
                    onChange={(e) => setEditFormData({ ...editFormData, note: e.target.value })}
                    maxLength={1000}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-white focus:border-amber-500 outline-none transition-all h-20 resize-none"
                    placeholder="Describe correction reason or manager notes..."
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-900/20"
                  >
                    {editSaving ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div> : <Save size={18} />}
                    Save Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingReport(null)}
                    className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-4 rounded-2xl font-black transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Delete Daily Report Confirmation Modal */}
      <AnimatePresence>
        {reportToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] border border-rose-500/30 rounded-3xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl p-6 space-y-4"
            >
              <div className="flex items-center gap-3 text-rose-400">
                <div className="p-3 bg-rose-500/10 rounded-2xl">
                  <Trash2 size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black uppercase text-white">Delete Daily Report</h3>
                  <p className="text-xs text-slate-400 font-bold">
                    {reportToDelete.date ? format(new Date(reportToDelete.date), 'MMM dd, yyyy') : 'Selected Report'}
                  </p>
                </div>
              </div>

              <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-800 text-xs text-slate-300 space-y-2">
                <p>Are you sure you want to permanently delete this report?</p>
                <div className="space-y-1 text-[11px] text-slate-400 font-mono">
                  <p>• Sales: {currency} {formatAmount((reportToDelete.cashSale || 0) + (reportToDelete.bankSale || 0), currency)}</p>
                  <p>• Expenses: {currency} {formatAmount((reportToDelete.cashExpense || 0) + (reportToDelete.bankExpense || 0), currency)}</p>
                  <p>• Closing Cash: {currency} {formatAmount(reportToDelete.closingCash || 0, currency)}</p>
                  <p>• Closing Bank: {currency} {formatAmount(reportToDelete.closingBank || 0, currency)}</p>
                </div>
                <p className="text-rose-400 font-bold text-[11px]">
                  Database document will be removed and any linked balances will be reversed.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={deleteLoading}
                  onClick={() => executeDeleteReport(reportToDelete)}
                  className="flex-1 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-black py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg shadow-rose-950/40 active:scale-95"
                >
                  {deleteLoading ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" /> : <Trash2 size={16} />}
                  Confirm Delete
                </button>
                <button
                  type="button"
                  disabled={deleteLoading}
                  onClick={() => setReportToDelete(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-black py-3.5 px-5 rounded-2xl text-xs uppercase tracking-wider transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Itemized Expenses Breakdown Modal */}
      <ExpensesBreakdownModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        initialItems={expenseItems}
        currency={currency}
        bankAccounts={branchBankAccounts}
        todayPurchaseBills={todayPurchaseBills}
        onApply={(items, totalCash, totalBank) => {
          setExpenseItems(items);
          setFormData(prev => ({
            ...prev,
            cashExpense: totalCash,
            bankExpense: totalBank,
          }));
        }}
      />

      {/* Monthly / Date-to-Date Financial Statement Modal */}
      <MonthlyStatementModal
        isOpen={isStatementOpen}
        onClose={() => setIsStatementOpen(false)}
        selectedBusiness={selectedBusiness}
        branches={branches}
        services={services}
        initialBranchId={selectedBranch?.id}
        initialServiceId={selectedService?.id}
      />

      {/* 1-Page End of Day Daily Closing Statement Modal (Z-Report) */}
      {closingReportToView && (
        <DailyClosingStatementModal
          report={closingReportToView}
          business={selectedBusiness}
          branch={selectedBranch || (branches.find(b => b.id === closingReportToView.branchId) || null)}
          currency={currency}
          onClose={() => setClosingReportToView(null)}
        />
      )}
    </div>
  );
}

function InputGroup({ label, value, onChange, readOnly, icon, step = "0.001" }: { label: string; value: number; onChange?: (v: number) => void; readOnly?: boolean; icon?: React.ReactNode; step?: string }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 flex items-center gap-1.5">
        {icon}
        {label}
      </label>
      <input
        type="number"
        step={step}
        value={value === 0 ? '' : value}
        onChange={(e) => onChange?.(parseFloat(e.target.value) || 0)}
        readOnly={readOnly}
        min="0"
        max="1000000000"
        className={cn(
          "w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm focus:border-blue-500 outline-none transition-all font-mono",
          readOnly && "opacity-60 cursor-not-allowed"
        )}
      />
    </div>
  );
}
