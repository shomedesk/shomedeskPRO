import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/src/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp
} from 'firebase/firestore';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { CurrencyConfig, Denomination, CashCountRecord } from '@/src/types';
import { Banknote, Coins, Save, History, Plus, Trash2, Calculator, Printer, AlertTriangle, Download } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { cn } from '@/src/lib/utils';
import { formatAmount } from '@/src/lib/currencyUtils';
import { downloadElementAsPdf, triggerDirectPrint } from '@/src/lib/pdfUtils';

const DEFAULT_CONFIGS: { [key: string]: any } = {
  OMR: {
    name: 'Omani Rial',
    symbol: 'RO',
    denominations: [
      { id: 'n50', value: 50, label: '50 Rial', type: 'note' },
      { id: 'n20', value: 20, label: '20 Rial', type: 'note' },
      { id: 'n10', value: 10, label: '10 Rial', type: 'note' },
      { id: 'n5', value: 5, label: '5 Rial', type: 'note' },
      { id: 'n1', value: 1, label: '1 Rial', type: 'note' },
      { id: 'n05', value: 0.5, label: '500 Baisa', type: 'note' },
      { id: 'n025', value: 0.25, label: '250 Baisa', type: 'note' },
      { id: 'n01', value: 0.1, label: '100 Baisa', type: 'note' },
      { id: 'c050', value: 0.05, label: '50 Baisa', type: 'coin' },
      { id: 'c025', value: 0.025, label: '25 Baisa', type: 'coin' },
      { id: 'c010', value: 0.01, label: '10 Baisa', type: 'coin' },
      { id: 'c005', value: 0.005, label: '5 Baisa', type: 'coin' },
    ]
  },
  BDT: {
    name: 'Bangladeshi Taka',
    symbol: '৳',
    denominations: [
      { id: 'n1000', value: 1000, label: '1000 Taka', type: 'note' },
      { id: 'n500', value: 500, label: '500 Taka', type: 'note' },
      { id: 'n200', value: 200, label: '200 Taka', type: 'note' },
      { id: 'n100', value: 100, label: '100 Taka', type: 'note' },
      { id: 'n50', value: 50, label: '50 Taka', type: 'note' },
      { id: 'n20', value: 20, label: '20 Taka', type: 'note' },
      { id: 'n10', value: 10, label: '10 Taka', type: 'note' },
      { id: 'n5', value: 5, label: '5 Taka', type: 'note' },
      { id: 'n2', value: 2, label: '2 Taka', type: 'note' },
      { id: 'c5', value: 5, label: '5 Taka Coin', type: 'coin' },
      { id: 'c2', value: 2, label: '2 Taka Coin', type: 'coin' },
      { id: 'c1', value: 1, label: '1 Taka Coin', type: 'coin' },
    ]
  },
  INR: {
    name: 'Indian Rupee',
    symbol: '₹',
    denominations: [
      { id: 'n2000', value: 2000, label: '2000 Rupee', type: 'note' },
      { id: 'n500', value: 500, label: '500 Rupee', type: 'note' },
      { id: 'n200', value: 200, label: '200 Rupee', type: 'note' },
      { id: 'n100', value: 100, label: '100 Rupee', type: 'note' },
      { id: 'n50', value: 50, label: '50 Rupee', type: 'note' },
      { id: 'n20', value: 20, label: '20 Rupee', type: 'note' },
      { id: 'n10', value: 10, label: '10 Rupee', type: 'note' },
      { id: 'n5', value: 5, label: '5 Rupee', type: 'note' },
      { id: 'c20', value: 20, label: '20 Rupee Coin', type: 'coin' },
      { id: 'c10', value: 10, label: '10 Rupee Coin', type: 'coin' },
      { id: 'c5', value: 5, label: '5 Rupee Coin', type: 'coin' },
      { id: 'c2', value: 2, label: '2 Rupee Coin', type: 'coin' },
      { id: 'c1', value: 1, label: '1 Rupee Coin', type: 'coin' },
    ]
  },
  USD: {
    name: 'US Dollar',
    symbol: '$',
    denominations: [
      { id: 'n100', value: 100, label: '$100 Bill', type: 'note' },
      { id: 'n50', value: 50, label: '$50 Bill', type: 'note' },
      { id: 'n20', value: 20, label: '$20 Bill', type: 'note' },
      { id: 'n10', value: 10, label: '$10 Bill', type: 'note' },
      { id: 'n5', value: 5, label: '$5 Bill', type: 'note' },
      { id: 'n2', value: 2, label: '$2 Bill', type: 'note' },
      { id: 'n1', value: 1, label: '$1 Bill', type: 'note' },
      { id: 'c100', value: 1, label: '$1 Coin', type: 'coin' },
      { id: 'c50', value: 0.5, label: '50¢ Coin', type: 'coin' },
      { id: 'c25', value: 0.25, label: '25¢ Quarter', type: 'coin' },
      { id: 'c10', value: 0.1, label: '10¢ Dime', type: 'coin' },
      { id: 'c05', value: 0.05, label: '5¢ Nickel', type: 'coin' },
      { id: 'c01', value: 0.01, label: '1¢ Penny', type: 'coin' },
    ]
  }
};

export default function CashCount() {
  const { selectedBusiness, selectedBranch, businesses, branches, isAllBusinessesSelected, userProfile } = useBusiness();
  const [currencyConfig, setCurrencyConfig] = useState<CurrencyConfig | null>(null);
  const [counts, setCounts] = useState<{ [key: string]: number }>({});
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<CashCountRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<CashCountRecord | null>(null);

  const activeCurrencyCode = selectedBusiness?.currency || 'OMR';

  useEffect(() => {
    if (!selectedBusiness && !isAllBusinessesSelected) return;

    const businessId = selectedBusiness?.id || (businesses.length > 0 ? businesses[0].id : null);
    const currencyCode = selectedBusiness?.currency || 'OMR';

    if (!businessId) return;

    const q = query(
      collection(db, 'currencyConfigs'),
      where('businessId', '==', businessId),
      where('code', '==', currencyCode)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setCurrencyConfig({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as CurrencyConfig);
      } else {
        const config = DEFAULT_CONFIGS[currencyCode] || DEFAULT_CONFIGS['OMR'];
        const defaultCurrency: CurrencyConfig = {
          id: `default-${currencyCode.toLowerCase()}`,
          code: currencyCode,
          name: config.name,
          symbol: config.symbol,
          businessId: businessId,
          ownerId: selectedBusiness?.ownerId || userProfile?.uid || '',
          createdAt: new Date(),
          denominations: config.denominations
        };
        setCurrencyConfig(defaultCurrency);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'currencyConfigs');
    });

    return () => unsub();
  }, [selectedBusiness, isAllBusinessesSelected, businesses, userProfile]);

  useEffect(() => {
    if (!selectedBusiness && !isAllBusinessesSelected) return;

    let unsub: () => void = () => {};

    if (isAllBusinessesSelected) {
      const businessIds = businesses.map(b => b.id);
      if (businessIds.length === 0) {
        setHistory([]);
        return;
      }

      const q = query(
        collection(db, 'cashCounts'),
        where('businessId', 'in', businessIds.slice(0, 10))
      );

      unsub = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CashCountRecord));
        setHistory(list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'cashCounts');
      });
    } else if (selectedBranch) {
      const q = query(
        collection(db, 'cashCounts'),
        where('businessId', '==', selectedBusiness!.id),
        where('branchId', '==', selectedBranch.id)
      );

      unsub = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CashCountRecord));
        setHistory(list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'cashCounts');
      });
    }

    return () => unsub();
  }, [selectedBusiness, selectedBranch, isAllBusinessesSelected, businesses]);

  const totalAmount = useMemo(() => {
    if (!currencyConfig) return 0;
    return currencyConfig.denominations.reduce((acc, den) => {
      const count = counts[den.id] || 0;
      return acc + (count * den.value);
    }, 0);
  }, [counts, currencyConfig]);

  const handleCountChange = (id: string, value: string) => {
    const num = parseInt(value) || 0;
    setCounts(prev => ({ ...prev, [id]: num }));
  };

  const handleSave = async () => {
    if (!selectedBusiness || !selectedBranch || !userProfile || !currencyConfig) return;
    if (totalAmount === 0) {
      toast.error('Total amount cannot be zero');
      return;
    }

    try {
      const record: CashCountRecord = {
        businessId: selectedBusiness.id,
        branchId: selectedBranch.id,
        ownerId: selectedBusiness.ownerId,
        userId: userProfile.uid,
        currencyId: currencyConfig.id,
        date: format(new Date(), 'yyyy-MM-dd'),
        counts,
        totalAmount,
        note,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'cashCounts'), record);
      toast.success('Cash count saved successfully');
      setCounts({});
      setNote('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'cashCounts');
      toast.error('Failed to save cash count');
    }
  };

  // Delete an individual cash count entry
  const handleDeleteRecord = async (id: string) => {
    if (!confirm('Are you sure you want to delete this cash count entry?')) return;
    try {
      await deleteDoc(doc(db, 'cashCounts', id));
      toast.success('Cash count record deleted');
      if (selectedRecord?.id === id) {
        setSelectedRecord(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'cashCounts');
      toast.error('Failed to delete cash count');
    }
  };

  const handlePrint = () => {
    triggerDirectPrint();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!selectedBranch) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-12 text-center">
        <Calculator className="w-16 h-16 text-slate-700 mx-auto mb-4" />
        <h2 className="text-xl font-black text-slate-300">Select a Branch</h2>
        <p className="text-slate-500 mt-2">Please select a branch to perform cash counting.</p>
      </div>
    );
  }

  const notes = currencyConfig?.denominations.filter(d => d.type === 'note') || [];
  const coins = currencyConfig?.denominations.filter(d => d.type === 'coin') || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Calculator className="text-blue-500" />
            Cash Denomination
          </h1>
          <p className="text-slate-500 font-medium mt-1">
            Count physical cash for <span className="text-blue-400">{selectedBranch.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition-all cursor-pointer active:scale-95 text-xs"
          >
            <History size={16} />
            {showHistory ? 'Back to Counter' : `History (${history.length})`}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition-all cursor-pointer active:scale-95 text-xs"
          >
            <Printer size={16} />
            Print
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showHistory ? (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-[#1E293B] border border-slate-800 rounded-3xl overflow-hidden shadow-xl"
          >
            <div className="p-6 border-b border-slate-800 bg-slate-900/50">
              <h2 className="text-lg font-black text-white">Counting History</h2>
              <p className="text-xs text-slate-400">
                Audit physical cash entries and denomination breakdowns
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-900/30 border-b border-slate-800">
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Date</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Location</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Amount</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Note</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-500 font-bold italic">
                        No cash count records found. (Ready for fresh start!)
                      </td>
                    </tr>
                  ) : (
                    history.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-slate-200">
                            {format(record.createdAt?.toDate ? record.createdAt.toDate() : new Date(), 'dd MMM yyyy')}
                          </p>
                          <p className="text-[10px] font-bold text-slate-500">
                            {format(record.createdAt?.toDate ? record.createdAt.toDate() : new Date(), 'hh:mm a')}
                          </p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-blue-400">
                            {branches.find(b => b.id === record.branchId)?.name || 'Branch'}
                          </p>
                          {isAllBusinessesSelected && (
                            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">
                              {businesses.find(b => b.id === record.businessId)?.name || 'Business'}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-black font-mono text-blue-400">
                            {currencyConfig?.symbol} {formatAmount(record.totalAmount, currencyConfig?.code || activeCurrencyCode)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-xs text-slate-400 truncate max-w-[200px]">{record.note || '-'}</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedRecord(record)}
                              className="text-blue-400 hover:text-blue-300 text-xs font-bold px-2 py-1 rounded hover:bg-blue-500/10 transition-colors cursor-pointer"
                            >
                              View Details
                            </button>
                            <button
                              type="button"
                              onClick={() => record.id && handleDeleteRecord(record.id)}
                              className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer"
                              title="Delete entry"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="counter"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
          >
            {/* Notes Section */}
            <div className="bg-[#1E293B] border border-slate-800 rounded-3xl p-6 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/10 rounded-2xl text-blue-500">
                    <Banknote size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white">Banknotes</h2>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Paper Currency</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {notes.map((den) => (
                  <DenominationInput
                    key={den.id}
                    denomination={den}
                    count={counts[den.id] || 0}
                    onChange={(val) => handleCountChange(den.id, val)}
                    symbol={currencyConfig?.symbol || 'RO'}
                    currencyCode={currencyConfig?.code || activeCurrencyCode}
                    isAccountant={false}
                  />
                ))}
              </div>
            </div>

            {/* Coins Section */}
            <div className="bg-[#1E293B] border border-slate-800 rounded-3xl p-6 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 rounded-2xl text-amber-500">
                    <Coins size={24} />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white">Coins / Baisa</h2>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Change & Denominations</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {coins.map((den) => (
                  <DenominationInput
                    key={den.id}
                    denomination={den}
                    count={counts[den.id] || 0}
                    onChange={(val) => handleCountChange(den.id, val)}
                    symbol={currencyConfig?.symbol || 'RO'}
                    currencyCode={currencyConfig?.code || activeCurrencyCode}
                    isAccountant={false}
                  />
                ))}
              </div>
            </div>

            {/* Summary & Save Section */}
            <div className="space-y-6">
              <div id="printable-cash-count" className="bg-[#1E293B] border border-slate-800 rounded-3xl p-6 space-y-6">
                <h2 className="text-lg font-black text-white pb-4 border-b border-slate-800">Counting Summary</h2>

                <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 text-center space-y-2">
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Total Cash Counted</p>
                  <p className="text-4xl font-black font-mono text-blue-500">
                    {currencyConfig?.symbol} {formatAmount(totalAmount, currencyConfig?.code || activeCurrencyCode)}
                  </p>
                  <p className="text-[11px] text-slate-400 font-bold">
                    {currencyConfig?.name || 'Omani Rial'} ({currencyConfig?.code === 'OMR' ? '3 Decimals / 1000 Baisa' : 'Standard'})
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">Remarks / Note</label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. End of day drawer balance, verified by supervisor..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-blue-500 transition-all resize-none h-24"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={totalAmount === 0}
                    className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-500/20 cursor-pointer"
                  >
                    <Save size={18} />
                    Save Cash Count
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedRecord && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#1E293B] border border-slate-800 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                <div>
                  <h2 className="text-lg font-black text-white">Cash Count Details</h2>
                  <p className="text-xs text-slate-500 font-bold">
                    {format(selectedRecord.createdAt?.toDate ? selectedRecord.createdAt.toDate() : new Date(), 'dd MMM yyyy, hh:mm a')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors cursor-pointer"
                >
                  <Plus className="rotate-45" size={24} />
                </button>
              </div>

              <div id="printable-record-detail" className="p-6 overflow-y-auto flex-1 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Branch</p>
                    <p className="text-sm font-bold text-white">
                      {branches.find(b => b.id === selectedRecord.branchId)?.name || 'Branch'}
                    </p>
                  </div>
                  <div className="bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20">
                    <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">Total Amount</p>
                    <p className="text-lg font-black font-mono text-blue-400">
                      {currencyConfig?.symbol} {formatAmount(selectedRecord.totalAmount, currencyConfig?.code || activeCurrencyCode)}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Denomination Breakdown</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currencyConfig?.denominations.map(den => {
                      const count = selectedRecord.counts[den.id] || 0;
                      if (count === 0) return null;
                      return (
                        <div key={den.id} className="flex justify-between items-center p-3 bg-slate-900/30 rounded-xl border border-slate-800/50">
                          <div>
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{den.label}</p>
                            <p className="text-xs font-bold text-slate-300 font-mono">
                              {formatAmount(den.value, currencyConfig?.code || activeCurrencyCode)} x {count}
                            </p>
                          </div>
                          <p className="text-sm font-black font-mono text-slate-200">
                            {currencyConfig.symbol} {formatAmount(count * den.value, currencyConfig?.code || activeCurrencyCode)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {selectedRecord.note && (
                  <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-800">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Remarks</p>
                    <p className="text-sm text-slate-300 italic">"{selectedRecord.note}"</p>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-800 bg-slate-900/50 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => triggerDirectPrint()}
                  className="flex-1 min-w-[120px] bg-slate-800 hover:bg-slate-700 text-white py-3 px-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
                >
                  <Printer size={16} />
                  Print Details
                </button>
                <button
                  type="button"
                  onClick={() => downloadElementAsPdf('printable-record-detail', `CashCount_${selectedRecord.id || 'record'}`)}
                  className="flex-1 min-w-[120px] bg-emerald-600 hover:bg-emerald-500 text-white py-3 px-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 shadow"
                >
                  <Download size={16} />
                  Save PDF
                </button>
                <button
                  type="button"
                  onClick={() => selectedRecord.id && handleDeleteRecord(selectedRecord.id)}
                  className="px-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
                  title="Delete this record"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="px-5 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-2xl font-bold text-xs transition-all cursor-pointer active:scale-95"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DenominationInput({ 
  denomination, 
  count, 
  onChange, 
  symbol,
  currencyCode,
  isAccountant
}: { 
  denomination: Denomination; 
  count: number; 
  onChange: (val: string) => void;
  symbol: string;
  currencyCode: string;
  isAccountant: boolean;
}) {
  const total = count * denomination.value;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 hover:border-blue-500/50 transition-all group">
      <div className="flex-1">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{denomination.label}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-slate-400">
            {formatAmount(denomination.value, currencyCode)} x
          </span>
          <input
            type="number"
            value={count || ''}
            min={0}
            max={1000000}
            onChange={(e) => onChange(e.target.value)}
            disabled={isAccountant}
            placeholder="0"
            className={cn(
              "w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-sm font-black text-white outline-none focus:border-blue-500 transition-all font-mono",
              isAccountant && "opacity-50 cursor-not-allowed"
            )}
          />
        </div>
      </div>
      <div className="text-right">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Subtotal</p>
        <p className={cn(
          "text-sm font-black font-mono transition-all",
          total > 0 ? "text-blue-400" : "text-slate-600"
        )}>
          {symbol} {formatAmount(total, currencyCode)}
        </p>
      </div>
    </div>
  );
}
