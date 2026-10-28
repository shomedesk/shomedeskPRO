import React, { useState, useEffect } from 'react';
import { ExpenseItem, BankAccount, PurchaseLog } from '@/src/types';
import { formatAmount, toStrictDecimal3 } from '@/src/lib/currencyUtils';
import { X, Plus, Trash2, Receipt, ShoppingCart, Landmark, Wallet, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ExpensesBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialItems: ExpenseItem[];
  currency: string;
  bankAccounts: BankAccount[];
  todayPurchaseBills: PurchaseLog[];
  onApply: (items: ExpenseItem[], totalCash: number, totalBank: number) => void;
}

const EXPENSE_CATEGORIES = [
  'Purchase Bill / Stock',
  'Shop Rent',
  'Staff Salary / Wages',
  'Electricity & Utilities',
  'Food & Refreshments',
  'Transport & Fuel',
  'Maintenance & Repairs',
  'Stationery & Packaging',
  'Government / Municipality Fees',
  'Internet & Phone',
  'General Expense'
];

export function ExpensesBreakdownModal({
  isOpen,
  onClose,
  initialItems,
  currency,
  bankAccounts,
  todayPurchaseBills,
  onApply,
}: ExpensesBreakdownModalProps) {
  const [items, setItems] = useState<ExpenseItem[]>(initialItems);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems, isOpen]);

  if (!isOpen) return null;

  const handleAddItem = () => {
    const newItem: ExpenseItem = {
      id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      category: 'General Expense',
      amount: 0,
      paymentType: 'cash',
      bankId: bankAccounts[0]?.id || '',
      bankName: bankAccounts[0]?.bankName || '',
      note: '',
    };
    setItems(prev => [...prev, newItem]);
  };

  const handleUpdateItem = (id: string, field: keyof ExpenseItem, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === 'bankId') {
        const found = bankAccounts.find(b => b.id === value);
        if (found) updated.bankName = found.bankName;
      }
      return updated;
    }));
  };

  const handleRemoveItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  // Import today's purchase bills into expenses breakdown
  const handleImportTodayBills = () => {
    const newItems: ExpenseItem[] = [];
    let count = 0;

    todayPurchaseBills.forEach(bill => {
      // Check if bill already imported
      const already = items.some(i => i.isPurchaseBill && i.purchaseInvoice === bill.invoiceNumber);
      if (!already) {
        const billPaid = Number(bill.paidAmount) || Number(bill.billAmount) || 0;
        const isBank = bill.paymentMode === 'bank' || bill.paymentMode === 'card' || bill.paymentMode === 'online';
        const bankObj = isBank && bill.bankAccountId ? bankAccounts.find(b => b.id === bill.bankAccountId) : bankAccounts[0];

        newItems.push({
          id: `exp_bill_${bill.id || Date.now()}`,
          category: 'Purchase Bill / Stock',
          amount: billPaid,
          paymentType: isBank ? 'bank' : 'cash',
          bankId: bankObj?.id || '',
          bankName: bankObj?.bankName || '',
          note: `Bill #${bill.invoiceNumber} - ${bill.supplierName}`,
          isPurchaseBill: true,
          purchaseInvoice: bill.invoiceNumber,
        });
        count++;
      }
    });

    if (count > 0) {
      setItems(prev => [...prev, ...newItems]);
      toast.success(`Imported ${count} purchase bill(s) into expenses!`);
    } else {
      toast.info("All today's purchase bills are already added to expenses.");
    }
  };

  const totalCash = items
    .filter(i => i.paymentType === 'cash')
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const totalBank = items
    .filter(i => i.paymentType === 'bank')
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const totalAll = totalCash + totalBank;

  const handleApply = () => {
    onApply(items, Math.round(totalCash * 1000) / 1000, Math.round(totalBank * 1000) / 1000);
    onClose();
    toast.success('Expenses applied to Daily Report successfully!');
  };

  const paidBillsCount = todayPurchaseBills.length;
  const paidBillsTotal = todayPurchaseBills.reduce((acc, b) => acc + (Number(b.paidAmount) || Number(b.billAmount) || 0), 0);

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70 flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20">
              <Receipt size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black uppercase tracking-wider text-slate-100">
                Itemized Expenses Breakdown
              </h2>
              <p className="text-[11px] text-slate-400 font-bold">
                Add separated expense items with payment types (Cash / Bank) & strict 3 decimal places
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1 custom-scrollbar">
          {/* Today's Purchase Bills Banner */}
          {paidBillsCount > 0 && (
            <div className="p-4 bg-indigo-950/30 border border-indigo-800/60 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShoppingCart className="text-indigo-400 shrink-0" size={20} />
                <div className="text-xs">
                  <p className="font-black text-slate-200 uppercase tracking-wider">
                    Today's Purchase Bills ({paidBillsCount})
                  </p>
                  <p className="text-slate-400 text-[11px]">
                    Total bills recorded today: <span className="font-mono font-bold text-indigo-300">{currency} {formatAmount(paidBillsTotal, currency)}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleImportTodayBills}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black py-2 px-3.5 rounded-xl transition-all shadow cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 self-start sm:self-auto"
              >
                <Plus size={14} /> Import Today's Bills
              </button>
            </div>
          )}

          {/* Controls Bar */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-300">
              Expenses Items ({items.length})
            </span>
            <button
              type="button"
              onClick={handleAddItem}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold py-2 px-3.5 rounded-xl border border-slate-700 transition-all cursor-pointer active:scale-95"
            >
              <Plus size={14} /> + Add Expense Item
            </button>
          </div>

          {/* Items List */}
          <div className="space-y-3">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-2xl space-y-3 hover:border-slate-700 transition-all"
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                  {/* Category Selector */}
                  <div className="sm:col-span-4">
                    <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                      Expense Category
                    </label>
                    <select
                      value={item.category}
                      onChange={(e) => handleUpdateItem(item.id, 'category', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 font-bold outline-none focus:border-indigo-500"
                    >
                      {EXPENSE_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  {/* Payment Type: Cash vs Bank */}
                  <div className="sm:col-span-3">
                    <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                      Paid Via
                    </label>
                    <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                      <button
                        type="button"
                        onClick={() => handleUpdateItem(item.id, 'paymentType', 'cash')}
                        className={`py-1.5 text-[11px] font-black uppercase rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                          item.paymentType === 'cash'
                            ? 'bg-emerald-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Wallet size={12} /> Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateItem(item.id, 'paymentType', 'bank')}
                        className={`py-1.5 text-[11px] font-black uppercase rounded-lg transition-all flex items-center justify-center gap-1 cursor-pointer ${
                          item.paymentType === 'bank'
                            ? 'bg-blue-600 text-white shadow'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Landmark size={12} /> Bank
                      </button>
                    </div>
                  </div>

                  {/* Amount with Strict 3 Decimal Precision */}
                  <div className="sm:col-span-4">
                    <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                      Amount ({currency})
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.amount === 0 ? '' : item.amount}
                        onChange={(e) => handleUpdateItem(item.id, 'amount', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                        placeholder="0.000"
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-right font-mono font-black text-rose-400 outline-none focus:border-rose-500"
                      />
                    </div>
                  </div>

                  {/* Delete Item */}
                  <div className="sm:col-span-1 flex justify-end sm:justify-center pt-2 sm:pt-0">
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="text-slate-500 hover:text-rose-400 p-2 rounded-lg hover:bg-slate-900 transition-all cursor-pointer"
                      title="Remove expense line"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Sub-row: Bank selection (if Bank) and Remarks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-900">
                  {item.paymentType === 'bank' && (
                    <div>
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                        Bank Account:
                      </label>
                      <select
                        value={item.bankId || ''}
                        onChange={(e) => handleUpdateItem(item.id, 'bankId', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-slate-300 font-bold outline-none focus:border-blue-500"
                      >
                        {bankAccounts.map(b => (
                          <option key={b.id} value={b.id}>
                            {b.bankName} - {b.accountName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className={item.paymentType === 'bank' ? '' : 'sm:col-span-2'}>
                    <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 block mb-1">
                      Note / Description (Optional):
                    </label>
                    <input
                      type="text"
                      value={item.note || ''}
                      onChange={(e) => handleUpdateItem(item.id, 'note', e.target.value)}
                      placeholder="e.g. Paid vendor, electricity bill #124"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-slate-300 outline-none focus:border-slate-600"
                    />
                  </div>
                </div>
              </div>
            ))}

            {items.length === 0 && (
              <div className="p-8 text-center bg-slate-950/40 rounded-2xl border border-dashed border-slate-800 text-slate-500 space-y-2">
                <Receipt className="mx-auto text-slate-600" size={28} />
                <p className="text-xs font-bold uppercase tracking-wider">No expense items added yet</p>
                <p className="text-[11px] text-slate-600">
                  Click "+ Add Expense Item" or import today's purchase bills to break down expenses by category.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Summary & Action */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row items-center justify-between gap-4 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
            <div>
              <span className="text-slate-500 text-[10px] uppercase block font-black">Cash Exp</span>
              <span className="font-mono font-black text-emerald-400">
                {currency} {formatAmount(totalCash, currency)}
              </span>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-slate-500 text-[10px] uppercase block font-black">Bank Exp</span>
              <span className="font-mono font-black text-blue-400">
                {currency} {formatAmount(totalBank, currency)}
              </span>
            </div>
            <div className="h-6 w-px bg-slate-800" />
            <div>
              <span className="text-slate-500 text-[10px] uppercase block font-black">Total Day Exp</span>
              <span className="font-mono font-black text-rose-400 text-sm">
                {currency} {formatAmount(totalAll, currency)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-2xl transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex-1 sm:flex-none px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider rounded-2xl shadow-lg shadow-blue-900/30 transition-all cursor-pointer active:scale-95 flex items-center justify-center gap-2"
            >
              <Check size={16} /> Apply to Daily Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
