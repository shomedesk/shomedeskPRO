import React, { useState, useEffect } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, limit, doc, updateDoc, deleteDoc, increment, writeBatch } from 'firebase/firestore';
import { Transaction, AccountType, TransactionType, BankAccount } from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { currencyService } from '@/src/services/currencyService';
import { formatAmount } from '@/src/lib/currencyUtils';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import { 
  Wallet, 
  Landmark, 
  Plus, 
  Minus, 
  ArrowRightLeft, 
  History,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Save,
  Trash2,
  Coins,
  CheckCircle2,
  X as XIcon
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { format } from 'date-fns';

interface FinanceManagerProps {
  accountType: AccountType;
}

export default function FinanceManager({ accountType }: FinanceManagerProps) {
  const { selectedBusiness, isAllBusinessesSelected, selectedBranch, selectedService, bankAccounts, businesses, branches, services, userProfile } = useBusiness();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddBankModalOpen, setIsAddBankModalOpen] = useState(false);
  const [modalType, setModalType] = useState<TransactionType>('income');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAllBusinessesSelected && !selectedBusiness) return;

    let q;
    if (isAllBusinessesSelected) {
      const bizIds = businesses.map(b => b.id).slice(0, 10);
      q = bizIds.length > 0
        ? query(collection(db, 'transactions'), where('businessId', 'in', bizIds), orderBy('date', 'desc'), limit(100))
        : query(collection(db, 'transactions'), orderBy('date', 'desc'), limit(100));
    } else {
      q = query(
        collection(db, 'transactions'),
        where('businessId', '==', selectedBusiness!.id),
        ...(selectedBranch ? [where('branchId', '==', selectedBranch.id)] : []),
        orderBy('date', 'desc'),
        limit(100)
      );
    }

    const unsub = onSnapshot(q, async (snapshot) => {
      const rawData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
      
      // Only convert amounts if multiple businesses with different currencies exist
      let data = rawData;
      const uniqueCurrencies = new Set(businesses.map(b => b.currency || 'OMR'));
      if (isAllBusinessesSelected && uniqueCurrencies.size > 1) {
        data = await Promise.all(rawData.map(async (t) => {
          const business = businesses.find(b => b.id === t.businessId);
          const tCurrency = business?.currency || 'OMR';
          if (tCurrency === 'INR') return t;
          
          const convertedAmount = await currencyService.convertToINR(t.amount, tCurrency);
          return { ...t, amount: convertedAmount };
        }));
      }

      // Filter transactions relevant to this account type
      const filtered = data.filter(t => {
        const isCorrectAccount = t.fromAccount === accountType || t.toAccount === accountType;
        return isCorrectAccount;
      });

      setTransactions(filtered);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'transactions');
      setLoading(false);
    });

    return () => unsub();
  }, [selectedBusiness, selectedBranch, accountType, isAllBusinessesSelected]);

  const filteredBankAccounts = isAllBusinessesSelected 
    ? bankAccounts.filter(ba => ba.businessId === 'global' || businesses.some(b => b.id === ba.businessId))
    : bankAccounts.filter(ba => 
        (ba.businessId === selectedBusiness?.id || ba.businessId === 'global') && 
        (selectedBranch 
          ? (ba.branchId === selectedBranch.id || ba.branchId === 'global' || !ba.branchId) 
          : (selectedService 
              ? (ba.serviceId === selectedService.id || !ba.serviceId) 
              : true)
        )
      );

  const balance = accountType === 'bank' 
    ? filteredBankAccounts.reduce((acc, ba) => acc + ba.balance, 0)
    : transactions.reduce((acc, t) => {
        if (t.toAccount === accountType) return acc + t.amount;
        if (t.fromAccount === accountType) return acc - t.amount;
        return acc;
      }, 0);

  // Operating Sales Income (From actual goods/services sold)
  const operatingIncome = transactions
    .filter(t => t.toAccount === accountType && t.type === 'income')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  // Capital & Investment Inflows (Owner equity, partner funds, bank loans - STRICTLY SEPARATED)
  const capitalInflows = transactions
    .filter(t => t.toAccount === accountType && (t.type === 'capital' || t.isCapital))
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  // Total Outflows / Expenses
  const totalOutflows = transactions
    .filter(t => t.fromAccount === accountType)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const openModal = (type: TransactionType) => {
    setModalType(type);
    setIsModalOpen(true);
  };

  const isAdmin = userProfile?.role === 'admin' || auth.currentUser?.email === 'shomedesk@gmail.com';
  const currency = isAllBusinessesSelected ? 'OMR' : (selectedBranch?.currency || selectedBusiness?.currency || 'OMR');

  const handleConvertToCapital = async (t: Transaction) => {
    if (!t.id || !isAdmin) return;
    try {
      await updateDoc(doc(db, 'transactions', t.id), {
        type: 'capital',
        isCapital: true,
        category: t.category.toLowerCase().includes('capital') || t.category.toLowerCase().includes('investment') 
          ? t.category 
          : `Capital / Investment (${t.category})`,
      });
      toast.success('Transaction converted to Capital / Investment! It is now excluded from operating income.');
    } catch (err) {
      toast.error('Failed to update transaction');
    }
  };

  const handleDeleteTransaction = async (t: Transaction) => {
    if (!t.id || !isAdmin) return;
    try {
      if (t.toAccount === 'bank' && t.toBankId) {
        try {
          await updateDoc(doc(db, 'bankAccounts', t.toBankId), {
            balance: increment(-t.amount)
          });
        } catch (bankErr) {
          console.warn('Bank account update skipped on transaction delete:', bankErr);
        }
      }
      if (t.fromAccount === 'bank' && t.fromBankId) {
        try {
          await updateDoc(doc(db, 'bankAccounts', t.fromBankId), {
            balance: increment(t.amount)
          });
        } catch (bankErr) {
          console.warn('Bank account update skipped on transaction delete:', bankErr);
        }
      }
      await deleteDoc(doc(db, 'transactions', t.id));
      toast.success('Transaction deleted and balances reversed successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${t.id}`);
      toast.error('Failed to delete transaction');
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black tracking-tight flex items-center gap-2 md:gap-3">
            {accountType === 'cash' ? <Wallet className="text-amber-400 w-6 h-6 md:w-8 md:h-8" /> : <Landmark className="text-blue-400 w-6 h-6 md:w-8 md:h-8" />}
            <span className="truncate">
              {isAllBusinessesSelected 
                ? `Company Main ${accountType === 'cash' ? 'Cash' : 'Bank'}` 
                : (selectedBranch 
                    ? `${selectedBranch.name} ${accountType === 'cash' ? 'Cash' : 'Bank'}`
                    : (selectedService
                        ? `${selectedService.name} ${accountType === 'cash' ? 'Cash' : 'Bank'}`
                        : `${selectedBusiness?.name} Main ${accountType === 'cash' ? 'Cash' : 'Bank'}`
                      )
                  )
              }
            </span>
          </h1>
          <p className="text-slate-400 font-bold text-[10px] md:text-sm uppercase tracking-widest truncate">
            {isAllBusinessesSelected 
              ? 'Global company liquidity' 
              : (selectedBranch 
                  ? `Manage ${selectedBranch.name} liquidity`
                  : (selectedService
                      ? `Manage ${selectedService.name} digital revenue`
                      : `Manage ${selectedBusiness?.name} central liquidity`
                    )
                )
            }
          </p>
        </div>
        <div className="text-left md:text-right w-full md:w-auto">
          <p className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5 md:mb-1">Total {accountType} Balance</p>
          <p className={cn("text-2xl md:text-4xl font-black font-mono tracking-tighter", balance >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {selectedBusiness?.currency || 'OMR'} {formatAmount(balance, selectedBusiness?.currency || 'OMR')}
          </p>
        </div>
      </div>

      {/* Financial Overview Cards separating Operating Income from Capital & Equity Inflows */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Total {accountType === 'cash' ? 'Cash' : 'Bank'} Balance
            </span>
            <div className={cn("p-1.5 rounded-lg", accountType === 'cash' ? "bg-amber-500/10 text-amber-400" : "bg-blue-500/10 text-blue-400")}>
              {accountType === 'cash' ? <Wallet size={16} /> : <Landmark size={16} />}
            </div>
          </div>
          <p className={cn("text-lg md:text-2xl font-black font-mono tracking-tight", balance >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {currency} {formatAmount(balance, currency)}
          </p>
          <p className="text-[9px] text-slate-500 font-bold mt-1">Current liquid funds</p>
        </div>

        <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Operating Sales Income
            </span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <TrendingUp size={16} />
            </div>
          </div>
          <p className="text-lg md:text-2xl font-black font-mono tracking-tight text-emerald-400">
            {currency} {formatAmount(operatingIncome, currency)}
          </p>
          <p className="text-[9px] text-slate-500 font-bold mt-1">From products & services</p>
        </div>

        <div className="bg-[#1E293B] p-4 rounded-2xl border border-purple-500/30 bg-purple-500/5 shadow-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] md:text-[10px] font-black text-purple-300 uppercase tracking-widest">
              Capital & Investments
            </span>
            <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400">
              <Coins size={16} />
            </div>
          </div>
          <p className="text-lg md:text-2xl font-black font-mono tracking-tight text-purple-400">
            {currency} {formatAmount(capitalInflows, currency)}
          </p>
          <p className="text-[9px] text-purple-300/70 font-bold mt-1">Owner equity & loans (Non-operating)</p>
        </div>

        <div className="bg-[#1E293B] p-4 rounded-2xl border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Total Outflows / Expenses
            </span>
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400">
              <TrendingDown size={16} />
            </div>
          </div>
          <p className="text-lg md:text-2xl font-black font-mono tracking-tight text-rose-400">
            {currency} {formatAmount(totalOutflows, currency)}
          </p>
          <p className="text-[9px] text-slate-500 font-bold mt-1">Paid expenses & transfers</p>
        </div>
      </div>

      {accountType === 'bank' && (
        <div className="space-y-3 md:space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest">Active Accounts</h3>
            {userProfile?.role !== 'accountant' && (
              <button 
                onClick={() => setIsAddBankModalOpen(true)}
                className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 bg-blue-600/10 text-blue-400 rounded-lg md:rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest hover:bg-blue-600/20 transition-all"
              >
                <Plus size={12} className="md:w-3.5 md:h-3.5" />
                Add Bank
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            {filteredBankAccounts.map(bank => (
              <div key={bank.id} className="bg-[#1E293B] p-3 md:p-4 rounded-xl md:rounded-2xl border border-slate-800 shadow-lg group hover:border-blue-500/30 transition-all">
                <div className="flex justify-between items-start mb-1 md:mb-2">
                  <p className="text-[8px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate">{bank.bankName}</p>
                  {bank.businessId === 'global' && (
                    <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 text-[7px] md:text-[8px] font-black uppercase tracking-widest rounded-full">Global</span>
                  )}
                </div>
                <h4 className="text-xs md:text-sm font-black text-slate-200 truncate">{bank.accountName}</h4>
                <p className="text-base md:text-lg font-black font-mono text-blue-400 mt-0.5 md:mt-1">
                  {isAllBusinessesSelected ? 'INR' : (selectedBusiness?.currency || 'OMR')}{' '}
                  {formatAmount(bank.balance, isAllBusinessesSelected ? 'INR' : (selectedBusiness?.currency || 'OMR'))}
                </p>
              </div>
            ))}
            {filteredBankAccounts.length === 0 && (
              <div className="col-span-full p-6 md:p-8 bg-slate-800/20 border border-dashed border-slate-800 rounded-xl md:rounded-2xl text-center">
                <p className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">No bank accounts found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {userProfile?.role !== 'accountant' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          <ActionButton onClick={() => openModal('capital')} label="Add Capital / Investment" icon={<Coins size={18} className="md:w-5 md:h-5 text-purple-300" />} color="bg-gradient-to-r from-purple-600 to-indigo-600 shadow-purple-900/30 ring-1 ring-purple-400/40" />
          <ActionButton onClick={() => openModal('income')} label="Income (Sales)" icon={<Plus size={18} className="md:w-5 md:h-5" />} color="bg-emerald-600 shadow-emerald-900/20" />
          <ActionButton onClick={() => openModal('expense')} label="Expense" icon={<Minus size={18} className="md:w-5 md:h-5" />} color="bg-rose-600 shadow-rose-900/20" />
          <ActionButton onClick={() => openModal('transfer')} label="Transfer" icon={<ArrowRightLeft size={18} className="md:w-5 md:h-5" />} color="bg-blue-600 shadow-blue-900/20" />
          <ActionButton onClick={() => openModal('withdraw')} label="Withdraw" icon={<ArrowDownRight size={18} className="md:w-5 md:h-5" />} color="bg-indigo-600 shadow-indigo-900/20" />
        </div>
      )}

      <div className="bg-[#1E293B] rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
            <History size={16} />
            Transaction History
          </h3>
        </div>
        <div className="divide-y divide-slate-800">
          {transactions.map((t) => (
            <TransactionItem
              key={t.id}
              transaction={t}
              currentAccount={accountType}
              currency={currency}
              isAdmin={isAdmin}
              onDelete={handleDeleteTransaction}
              onConvertToCapital={handleConvertToCapital}
            />
          ))}
          {transactions.length === 0 && (
            <div className="p-12 text-center text-slate-500 font-bold uppercase tracking-widest text-xs">
              No transactions found
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <TransactionModal 
          type={modalType} 
          accountType={accountType} 
          onClose={() => setIsModalOpen(false)} 
        />
      )}

      {isAddBankModalOpen && (
        <AddBankModal onClose={() => setIsAddBankModalOpen(false)} />
      )}
    </div>
  );
}

function AddBankModal({ onClose }: { onClose: () => void }) {
  const { selectedBusiness, isAllBusinessesSelected, selectedBranch } = useBusiness();
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [balance, setBalance] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;

    setLoading(true);
    try {
      const newBank: Omit<BankAccount, 'id'> = {
        businessId: isAllBusinessesSelected ? 'global' : selectedBusiness!.id,
        branchId: isAllBusinessesSelected ? 'global' : (selectedBranch?.id || 'global'),
        ownerId: auth.currentUser.uid,
        bankName,
        accountName,
        accountNumber,
        balance: parseFloat(balance) || 0,
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'bankAccounts'), newBank);
      toast.success('Bank account added successfully');
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bankAccounts');
      toast.error('Failed to add bank account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1E293B] w-full max-w-md rounded-3xl border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-black uppercase tracking-widest flex items-center gap-2">
            <Landmark className="text-blue-400" />
            Add {isAllBusinessesSelected ? 'Company' : 'Business'} Bank Account
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><XIcon size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Bank Name</label>
            <input
              type="text"
              required
              maxLength={100}
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
              placeholder="e.g. Chase, HSBC"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Account Name</label>
            <input
              type="text"
              required
              maxLength={100}
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
              placeholder="e.g. Main Business Account"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Account Number</label>
            <input
              type="text"
              required
              maxLength={50}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
              placeholder="•••• •••• •••• 1234"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Initial Balance</label>
            <input
              type="text"
              inputMode="decimal"
              required
              value={balance}
              onChange={(e) => {
                let raw = e.target.value.replace(',', '.');
                if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
                  setBalance(raw);
                }
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500 font-mono"
              placeholder="0.000"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
          >
            {loading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div> : <Save size={20} />}
            Add Account
          </button>
        </form>
      </div>
    </div>
  );
}

function ActionButton({ onClick, label, icon, color }: { onClick: () => void; label: string; icon: React.ReactNode; color: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-2 md:gap-3 p-4 md:p-6 rounded-2xl md:rounded-3xl text-white font-black transition-all active:scale-95 shadow-lg",
        color
      )}
    >
      <div className="bg-white/20 p-1.5 md:p-2 rounded-lg md:rounded-xl">{icon}</div>
      <span className="text-[10px] md:text-xs uppercase tracking-widest">{label}</span>
    </button>
  );
}

interface TransactionItemProps {
  transaction: Transaction;
  currentAccount: AccountType;
  currency: string;
  isAdmin?: boolean;
  onDelete?: (t: Transaction) => void;
  onConvertToCapital?: (t: Transaction) => void;
}

const TransactionItem: React.FC<TransactionItemProps> = ({ 
  transaction, 
  currentAccount, 
  currency, 
  isAdmin, 
  onDelete,
  onConvertToCapital 
}) => {
  const isIncoming = transaction.toAccount === currentAccount;
  const isCapital = transaction.type === 'capital' || transaction.isCapital;
  const [deleting, setDeleting] = useState(false);
  const [converting, setConverting] = useState(false);

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(transaction);
    } finally {
      setDeleting(false);
    }
  };

  const handleConvert = async () => {
    if (!onConvertToCapital) return;
    setConverting(true);
    try {
      await onConvertToCapital(transaction);
    } finally {
      setConverting(false);
    }
  };
  
  return (
    <div className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-slate-800/50 transition-colors">
      <div className="flex items-center gap-3 md:gap-4">
        <div className={cn(
          "p-2 rounded-xl flex-shrink-0",
          isCapital
            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
            : isIncoming 
            ? "bg-emerald-500/10 text-emerald-400" 
            : "bg-rose-500/10 text-rose-400"
        )}>
          {isCapital ? <Coins size={20} /> : isIncoming ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-200">{transaction.category}</p>
            {isCapital && (
              <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded text-[8px] font-black uppercase tracking-wider">
                Capital / Equity
              </span>
            )}
            {transaction.type === 'income' && !isCapital && (
              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[8px] font-black uppercase tracking-wider">
                Sales Income
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">
            {transaction.description || (isCapital ? 'Capital / Investment Deposit' : transaction.type)} • {format(new Date(transaction.date), 'MMM dd, HH:mm')}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
        {isAdmin && onConvertToCapital && transaction.type === 'income' && (
          <button
            type="button"
            disabled={converting}
            onClick={handleConvert}
            className="px-2 py-1 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-lg text-[9px] font-bold transition-all cursor-pointer active:scale-95 disabled:opacity-50 flex items-center gap-1"
            title="Convert to Capital / Investment so this amount is NOT counted as operating revenue or sales profit"
          >
            <Coins size={11} />
            <span>{converting ? 'Converting...' : 'Mark as Capital'}</span>
          </button>
        )}
        <div className="text-right">
          <p className={cn(
            "text-sm font-black font-mono", 
            isCapital ? "text-purple-400" : isIncoming ? "text-emerald-400" : "text-rose-400"
          )}>
            {isIncoming ? '+' : '-'} {currency} {formatAmount(transaction.amount, currency)}
          </p>
        </div>
        {isAdmin && onDelete && (
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            title="Admin: Delete transaction and reverse balances"
          >
            {deleting ? <div className="animate-spin rounded-full h-3.5 w-3.5 border-t border-b border-rose-400" /> : <Trash2 size={15} />}
          </button>
        )}
      </div>
    </div>
  );
};

function TransactionModal({ type, accountType, onClose }: { type: TransactionType; accountType: AccountType; onClose: () => void }) {
  const { selectedBusiness, isAllBusinessesSelected, selectedBranch, selectedService, bankAccounts, businesses, branches, services } = useBusiness();
  const [destinationAccount, setDestinationAccount] = useState<AccountType>(accountType);
  const [capitalSource, setCapitalSource] = useState<string>('owner_equity');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(type === 'capital' ? 'Owner Capital / Investment' : '');
  const [description, setDescription] = useState('');
  const [fromBankId, setFromBankId] = useState('');
  const [toBankId, setToBankId] = useState(bankAccounts[0]?.id || '');
  const [targetBusinessId, setTargetBusinessId] = useState('');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [targetServiceId, setTargetServiceId] = useState('');
  const [transferType, setTransferType] = useState<'cash-to-bank' | 'bank-to-cash' | 'bank-to-bank' | 'business-to-company' | 'company-to-business' | 'company-cash-to-branch-cash' | 'branch-cash-to-company-cash'>('cash-to-bank');
  const [loading, setLoading] = useState(false);

  // Set default transfer type based on context
  useEffect(() => {
    if (type === 'transfer') {
      if (isAllBusinessesSelected) {
        setTransferType('company-cash-to-branch-cash');
      } else if (selectedBranch) {
        setTransferType('branch-cash-to-company-cash');
      } else {
        setTransferType('cash-to-bank');
      }
    }
  }, [type, isAllBusinessesSelected, selectedBranch]);

  // Auto-select banks based on transfer type
  useEffect(() => {
    if (type === 'transfer') {
      if (transferType === 'business-to-company') {
        const firstBusinessBank = bankAccounts.find(b => b.businessId !== 'global');
        const firstCompanyBank = bankAccounts.find(b => b.businessId === 'global');
        if (firstBusinessBank) setFromBankId(firstBusinessBank.id);
        if (firstCompanyBank) setToBankId(firstCompanyBank.id);
      } else if (transferType === 'company-to-business') {
        const firstCompanyBank = bankAccounts.find(b => b.businessId === 'global');
        const firstBusinessBank = bankAccounts.find(b => b.businessId !== 'global');
        if (firstCompanyBank) setFromBankId(firstCompanyBank.id);
        if (firstBusinessBank) setToBankId(firstBusinessBank.id);
      }
    }
  }, [transferType, type, bankAccounts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    if (!isAllBusinessesSelected && !selectedBusiness) return;

    setLoading(true);
    try {
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt <= 0) {
        toast.error('Please enter a valid amount greater than 0');
        setLoading(false);
        return;
      }
      let businessId = isAllBusinessesSelected ? (targetBusinessId || 'global') : selectedBusiness!.id;
      
      // For transfers between business and company banks, associate with the business so it shows in branch history
      if (transferType === 'business-to-company' || transferType === 'company-to-business') {
        const branchBankId = transferType === 'business-to-company' ? fromBankId : toBankId;
        const branchBank = bankAccounts.find(b => b.id === branchBankId);
        if (branchBank && branchBank.businessId !== 'global') {
          businessId = branchBank.businessId;
        }
      }

      const commonData = {
        ownerId: selectedBusiness?.ownerId || auth.currentUser.uid,
        userId: auth.currentUser.uid,
        amount: amt,
        category: category || (type === 'capital' ? 'Owner Capital / Investment' : type.toUpperCase()),
        description,
        date: new Date().toISOString(),
        createdAt: serverTimestamp(),
      };

      const batch = writeBatch(db);

      if (type === 'capital') {
        const destAccount = destinationAccount || accountType;
        const transactionRef = doc(collection(db, 'transactions'));
        const effectiveCategory = category.trim() || 
          (capitalSource === 'owner_equity' ? 'Owner Capital / Investment' :
           capitalSource === 'partner_investment' ? 'Partner Investment' :
           capitalSource === 'bank_loan' ? 'Bank / Business Loan' :
           capitalSource === 'personal_loan' ? 'Personal / Investor Loan' :
           'Capital / Investment Injection');

        const transaction: Transaction = {
          ...commonData,
          businessId,
          branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
          serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
          type: 'capital',
          category: effectiveCategory,
          toAccount: destAccount,
          isCapital: true,
          capitalSource,
        };

        if (destAccount === 'bank') {
          const effectiveToBankId = toBankId || bankAccounts[0]?.id;
          if (!effectiveToBankId) {
            toast.error('Please select a destination bank account');
            setLoading(false);
            return;
          }
          transaction.toBankId = effectiveToBankId;
          batch.update(doc(db, 'bankAccounts', effectiveToBankId), { balance: increment(amt) });
        }
        batch.set(transactionRef, transaction);
      } else if (type === 'income') {
        const transactionRef = doc(collection(db, 'transactions'));
        const transaction: Transaction = {
          ...commonData,
          businessId,
          branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
          serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
          type,
          toAccount: accountType,
        };
        if (accountType === 'bank') {
          transaction.toBankId = toBankId;
          batch.update(doc(db, 'bankAccounts', toBankId), { balance: increment(amt) });
        }
        batch.set(transactionRef, transaction);
      } else if (type === 'expense') {
        const transactionRef = doc(collection(db, 'transactions'));
        const transaction: Transaction = {
          ...commonData,
          businessId,
          branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
          serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
          type,
          fromAccount: accountType,
        };
        if (accountType === 'bank') {
          transaction.fromBankId = fromBankId;
          batch.update(doc(db, 'bankAccounts', fromBankId), { balance: increment(-amt) });
        }
        batch.set(transactionRef, transaction);
      } else if (type === 'transfer') {
        if (transferType === 'cash-to-bank') {
          const transactionRef = doc(collection(db, 'transactions'));
          batch.set(transactionRef, {
            ...commonData,
            businessId,
            branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
            serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
            type,
            fromAccount: 'cash',
            toAccount: 'bank',
            toBankId,
          });
          batch.update(doc(db, 'bankAccounts', toBankId), { balance: increment(amt) });
        } else if (transferType === 'bank-to-cash') {
          const transactionRef = doc(collection(db, 'transactions'));
          batch.set(transactionRef, {
            ...commonData,
            businessId,
            branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
            serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
            type,
            fromAccount: 'bank',
            toAccount: 'cash',
            fromBankId,
          });
          batch.update(doc(db, 'bankAccounts', fromBankId), { balance: increment(-amt) });
        } else if (transferType === 'bank-to-bank') {
          const transactionRef = doc(collection(db, 'transactions'));
          batch.set(transactionRef, {
            ...commonData,
            businessId,
            branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
            serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
            type,
            fromAccount: 'bank',
            toAccount: 'bank',
            fromBankId,
            toBankId,
          });
          batch.update(doc(db, 'bankAccounts', fromBankId), { balance: increment(-amt) });
          batch.update(doc(db, 'bankAccounts', toBankId), { balance: increment(amt) });
        } else if (transferType === 'business-to-company') {
          // 1. Transaction for Business/Branch (Out)
          const t1Ref = doc(collection(db, 'transactions'));
          batch.set(t1Ref, {
            ...commonData,
            businessId: selectedBusiness?.id || businessId,
            branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
            serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
            type,
            fromAccount: 'bank',
            toAccount: 'bank',
            fromBankId,
            toBankId,
            description: description || `Transfer to Company Main Bank`,
          });
          
          // 2. Transaction for Company Main (In)
          const t2Ref = doc(collection(db, 'transactions'));
          batch.set(t2Ref, {
            ...commonData,
            businessId: 'global',
            branchId: 'global',
            serviceId: 'global',
            type,
            fromAccount: 'bank',
            toAccount: 'bank',
            fromBankId,
            toBankId,
            description: description || `Transfer from ${selectedBusiness?.name || 'Business'}`,
          });

          batch.update(doc(db, 'bankAccounts', fromBankId), { balance: increment(-amt) });
          batch.update(doc(db, 'bankAccounts', toBankId), { balance: increment(amt) });
        } else if (transferType === 'company-to-business') {
          const targetBiz = businesses.find(b => b.id === targetBusinessId) || selectedBusiness;
          
          // 1. Transaction for Company Main (Out)
          const t1Ref = doc(collection(db, 'transactions'));
          batch.set(t1Ref, {
            ...commonData,
            businessId: 'global',
            branchId: 'global',
            serviceId: 'global',
            type,
            fromAccount: 'bank',
            toAccount: 'bank',
            fromBankId,
            toBankId,
            description: description || `Transfer to ${targetBiz?.name || 'Business'} Bank`,
          });
          
          // 2. Transaction for Business/Branch (In)
          const t2Ref = doc(collection(db, 'transactions'));
          batch.set(t2Ref, {
            ...commonData,
            businessId: targetBiz?.id || businessId,
            branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
            serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
            type,
            fromAccount: 'bank',
            toAccount: 'bank',
            fromBankId,
            toBankId,
            description: description || `Transfer from Company Main Bank`,
          });

          batch.update(doc(db, 'bankAccounts', fromBankId), { balance: increment(-amt) });
          batch.update(doc(db, 'bankAccounts', toBankId), { balance: increment(amt) });
        } else if (transferType === 'company-cash-to-branch-cash') {
          const targetBranch = branches.find(b => b.id === targetBranchId);
          if (!targetBranch) throw new Error('Target branch not found');
          
          // 1. Transaction for Company Main (Out)
          const t1Ref = doc(collection(db, 'transactions'));
          batch.set(t1Ref, {
            ...commonData,
            businessId: 'global',
            branchId: 'global',
            serviceId: 'global',
            type,
            fromAccount: 'cash',
            description: description || `Transfer to ${targetBranch.name}`,
          });
          
          // 2. Transaction for Branch (In)
          const t2Ref = doc(collection(db, 'transactions'));
          batch.set(t2Ref, {
            ...commonData,
            businessId: targetBranch.businessId,
            branchId: targetBranch.id,
            serviceId: 'global',
            type,
            toAccount: 'cash',
            description: description || `Transfer from Company Main`,
          });
        } else if (transferType === 'branch-cash-to-company-cash') {
          if (!selectedBranch) throw new Error('Source branch not selected');
          
          // 1. Transaction for Branch (Out)
          const t1Ref = doc(collection(db, 'transactions'));
          batch.set(t1Ref, {
            ...commonData,
            businessId: selectedBusiness!.id,
            branchId: selectedBranch.id,
            serviceId: 'global',
            type,
            fromAccount: 'cash',
            description: description || `Transfer to Company Main`,
          });
          
          // 2. Transaction for Company Main (In)
          const t2Ref = doc(collection(db, 'transactions'));
          batch.set(t2Ref, {
            ...commonData,
            businessId: 'global',
            branchId: 'global',
            serviceId: 'global',
            type,
            toAccount: 'cash',
            description: description || `Transfer from ${selectedBranch.name}`,
          });
        }
      } else if (type === 'withdraw') {
        const transactionRef = doc(collection(db, 'transactions'));
        const transaction: Transaction = {
          ...commonData,
          businessId,
          branchId: isAllBusinessesSelected ? (targetBranchId || 'global') : (selectedBranch?.id || 'global'),
          serviceId: isAllBusinessesSelected ? (targetServiceId || 'global') : (selectedService?.id || 'global'),
          type,
          fromAccount: 'bank',
          toAccount: 'cash',
          fromBankId,
        };
        batch.update(doc(db, 'bankAccounts', fromBankId), { balance: increment(-amt) });
        batch.set(transactionRef, transaction);
      }

      await batch.commit();
      toast.success('Transaction recorded successfully');
      onClose();
    } catch (error) {
      console.error(error);
      toast.error('Failed to record transaction');
    } finally {
      setLoading(false);
    }
  };

  const businessBanks = bankAccounts.filter(b => b.businessId !== 'global');
  const companyBanks = bankAccounts.filter(b => b.businessId === 'global');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
          <h2 className="text-lg font-black uppercase tracking-widest flex items-center gap-2">
            {type === 'income' && <Plus className="text-emerald-400" />}
            {type === 'expense' && <Minus className="text-rose-400" />}
            {type === 'transfer' && <ArrowRightLeft className="text-blue-400" />}
            {type === 'capital' && <Coins className="text-purple-400" />}
            {type === 'capital' ? 'Add Capital / Investment' : `${type} ${accountType}`}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><XIcon size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
          {type === 'capital' && (
            <div className="p-3.5 bg-purple-500/10 border border-purple-500/30 rounded-2xl flex items-start gap-3">
              <Coins className="text-purple-400 w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-purple-200">
                <p className="font-bold text-white flex items-center gap-1.5">
                  Non-Operating Equity / Capital Injection
                  <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded font-black">Strict Accounting</span>
                </p>
                <p className="text-[11px] text-purple-300/80 mt-1 leading-relaxed">
                  This money will directly fund your {destinationAccount === 'cash' ? 'Cash Drawer' : 'Bank Account'} balance without inflating your Sales Revenue, Gross Profit, or Net Operating Profit.
                </p>
              </div>
            </div>
          )}

          {type === 'capital' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Deposit Destination</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDestinationAccount('cash')}
                  className={cn(
                    "p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-black transition-all cursor-pointer",
                    destinationAccount === 'cash'
                      ? "bg-amber-500/20 border-amber-500 text-amber-400 shadow-md"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                  )}
                >
                  <Wallet size={16} />
                  <span>Cash Drawer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDestinationAccount('bank')}
                  className={cn(
                    "p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-black transition-all cursor-pointer",
                    destinationAccount === 'bank'
                      ? "bg-blue-500/20 border-blue-500 text-blue-400 shadow-md"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                  )}
                >
                  <Landmark size={16} />
                  <span>Bank Account</span>
                </button>
              </div>
            </div>
          )}

          {type === 'capital' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Capital / Investment Source</label>
              <select
                value={capitalSource}
                onChange={(e) => {
                  const val = e.target.value;
                  setCapitalSource(val);
                  const labels: Record<string, string> = {
                    owner_equity: 'Owner Capital / Investment',
                    partner_investment: 'Partner Investment',
                    bank_loan: 'Bank / Business Loan',
                    personal_loan: 'Personal Loan / Debt',
                    investor_fund: 'Investor Equity Fund',
                    other: 'Other Capital Injection',
                  };
                  setCategory(labels[val] || 'Capital Injection');
                }}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500 font-bold"
              >
                <option value="owner_equity">Owner Capital / Investment (মালিকের নিজস্ব মূলধন)</option>
                <option value="partner_investment">Partner Investment (অংশীদারের বিনিয়োগ)</option>
                <option value="bank_loan">Bank / Commercial Loan (ব্যবসায়িক / ব্যাংক লোন)</option>
                <option value="personal_loan">Personal Loan (ব্যক্তিগত ঋণ)</option>
                <option value="investor_fund">Investor Equity (ইনভেস্টর ফান্ড)</option>
                <option value="other">Other Capital Injection (অন্যান্য মূলধন)</option>
              </select>
            </div>
          )}

          {type === 'transfer' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Transfer Type</label>
              <select 
                value={transferType}
                onChange={(e) => setTransferType(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
              >
                <optgroup label="Internal Transfers">
                  <option value="cash-to-bank">Cash to Bank</option>
                  <option value="bank-to-cash">Bank to Cash</option>
                  <option value="bank-to-bank">Bank to Bank</option>
                </optgroup>
                <optgroup label="Cross-Level Transfers">
                  <option value="business-to-company">Business Bank to Company Main Bank</option>
                  <option value="company-to-business">Company Main Bank to Business Bank</option>
                  <option value="company-cash-to-branch-cash">Company Main Cash to Branch Cash</option>
                  <option value="branch-cash-to-company-cash">Branch Cash to Company Main Cash</option>
                </optgroup>
              </select>
            </div>
          )}

          {type === 'transfer' && transferType === 'company-cash-to-branch-cash' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Target Branch</label>
              <select 
                required
                value={targetBranchId}
                onChange={(e) => setTargetBranchId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
              >
                <option value="">Select Branch</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {businesses.find(biz => biz.id === b.businessId)?.name} - {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isAllBusinessesSelected && type !== 'transfer' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Target Business</label>
              <select 
                value={targetBusinessId}
                onChange={(e) => setTargetBusinessId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
              >
                <option value="global">Company (Global)</option>
                {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Branch/Service Selectors when in All mode or no specific branch/service selected */}
          {type !== 'transfer' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Target Branch</label>
                <select 
                  value={targetBranchId}
                  onChange={(e) => {
                    setTargetBranchId(e.target.value);
                    if (e.target.value) setTargetServiceId('');
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">No Branch (Global)</option>
                  {branches
                    .filter(b => isAllBusinessesSelected ? (targetBusinessId === 'global' || b.businessId === targetBusinessId) : b.businessId === selectedBusiness?.id)
                    .map(b => <option key={b.id} value={b.id}>{b.name}</option>)
                  }
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Target Service</label>
                <select 
                  value={targetServiceId}
                  onChange={(e) => {
                    setTargetServiceId(e.target.value);
                    if (e.target.value) setTargetBranchId('');
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">No Service (Global)</option>
                  {services
                    .filter(s => isAllBusinessesSelected ? (targetBusinessId === 'global' || s.businessId === targetBusinessId) : s.businessId === selectedBusiness?.id)
                    .map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                  }
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* From Bank selector */}
            {(
              (type === 'expense' && accountType === 'bank') || 
              (type === 'withdraw') ||
              (type === 'transfer' && (transferType === 'bank-to-cash' || transferType === 'bank-to-bank' || transferType === 'business-to-company' || transferType === 'company-to-business'))
            ) && (
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">From Bank</label>
                <select 
                  required
                  value={fromBankId}
                  onChange={(e) => setFromBankId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">Select Bank</option>
                  {transferType === 'business-to-company' ? businessBanks.map(b => <option key={b.id} value={b.id}>{b.bankName} ({b.accountName})</option>) :
                   transferType === 'company-to-business' ? companyBanks.map(b => <option key={b.id} value={b.id}>{b.bankName} ({b.accountName})</option>) :
                   bankAccounts.map(b => <option key={b.id} value={b.id}>{b.bankName} ({b.accountName})</option>)}
                </select>
              </div>
            )}

            {/* To Bank selector */}
            {(
              (type === 'income' && accountType === 'bank') ||
              (type === 'capital' && destinationAccount === 'bank') ||
              (type === 'transfer' && (transferType === 'cash-to-bank' || transferType === 'bank-to-bank' || transferType === 'business-to-company' || transferType === 'company-to-business'))
            ) && (
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">To Bank Account</label>
                <select 
                  required
                  value={toBankId}
                  onChange={(e) => setToBankId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">Select Bank Account</option>
                  {transferType === 'business-to-company' ? companyBanks.map(b => <option key={b.id} value={b.id}>{b.bankName} ({b.accountName})</option>) :
                   transferType === 'company-to-business' ? businessBanks.map(b => <option key={b.id} value={b.id}>{b.bankName} ({b.accountName})</option>) :
                   bankAccounts.map(b => <option key={b.id} value={b.id}>{b.bankName} ({b.accountName})</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Amount</label>
            <input
              type="text"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => {
                let raw = e.target.value.replace(',', '.');
                if (raw === '' || /^[0-9]*\.?[0-9]*$/.test(raw)) {
                  setAmount(raw);
                }
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-lg font-black text-blue-400 outline-none focus:border-blue-500 font-mono"
              placeholder="0.000"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Category</label>
            <input
              type="text"
              required
              maxLength={100}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
              placeholder="e.g. Sales, Rent, Salary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Description</label>
            <textarea
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500 h-24 resize-none"
              placeholder="Optional details..."
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className={cn(
              "w-full disabled:opacity-50 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg",
              type === 'capital' 
                ? "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-purple-900/30" 
                : "bg-blue-600 hover:bg-blue-500 shadow-blue-900/20"
            )}
          >
            {loading ? <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></div> : type === 'capital' ? <Coins size={20} /> : <Save size={20} />}
            {type === 'capital' ? 'Deposit Capital / Investment' : 'Record Transaction'}
          </button>
        </form>
      </div>
    </div>
  );
}

function X({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );
}
