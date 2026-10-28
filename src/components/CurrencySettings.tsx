import React, { useState, useEffect } from 'react';
import { db } from '@/src/lib/firebase';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { CurrencyConfig, Denomination } from '@/src/types';
import { Banknote, Coins, Plus, Trash2, Save, Globe, Info, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';

export default function CurrencySettings() {
  const { selectedBusiness, userProfile } = useBusiness();
  const [configs, setConfigs] = useState<CurrencyConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<CurrencyConfig | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  const CURRENCY_TEMPLATES = {
    OMR: {
      name: 'Omani Rial',
      symbol: 'RO',
      denominations: [
        { id: 'n1', value: 50, label: '50 Rial', type: 'note' },
        { id: 'n2', value: 20, label: '20 Rial', type: 'note' },
        { id: 'n3', value: 10, label: '10 Rial', type: 'note' },
        { id: 'n4', value: 5, label: '5 Rial', type: 'note' },
        { id: 'n5', value: 1, label: '1 Rial', type: 'note' },
        { id: 'n6', value: 0.5, label: '1/2 Rial', type: 'note' },
        { id: 'n7', value: 0.1, label: '100 Baisa', type: 'note' },
        { id: 'c1', value: 0.05, label: '50 Baisa', type: 'coin' },
        { id: 'c2', value: 0.025, label: '25 Baisa', type: 'coin' },
        { id: 'c3', value: 0.01, label: '10 Baisa', type: 'coin' },
        { id: 'c4', value: 0.005, label: '5 Baisa', type: 'coin' },
      ]
    },
    INR: {
      name: 'Indian Rupee',
      symbol: '₹',
      denominations: [
        { id: 'n1', value: 2000, label: '2000 Note', type: 'note' },
        { id: 'n2', value: 500, label: '500 Note', type: 'note' },
        { id: 'n3', value: 200, label: '200 Note', type: 'note' },
        { id: 'n4', value: 100, label: '100 Note', type: 'note' },
        { id: 'n5', value: 50, label: '50 Note', type: 'note' },
        { id: 'n6', value: 20, label: '20 Note', type: 'note' },
        { id: 'n7', value: 10, label: '10 Note', type: 'note' },
        { id: 'c1', value: 20, label: '20 Coin', type: 'coin' },
        { id: 'c2', value: 10, label: '10 Coin', type: 'coin' },
        { id: 'c3', value: 5, label: '5 Coin', type: 'coin' },
        { id: 'c4', value: 2, label: '2 Coin', type: 'coin' },
        { id: 'c5', value: 1, label: '1 Coin', type: 'coin' },
      ]
    },
    AED: {
      name: 'UAE Dirham',
      symbol: 'د.إ',
      denominations: [
        { id: 'n1', value: 1000, label: '1000 Dirham', type: 'note' },
        { id: 'n2', value: 500, label: '500 Dirham', type: 'note' },
        { id: 'n3', value: 200, label: '200 Dirham', type: 'note' },
        { id: 'n4', value: 100, label: '100 Dirham', type: 'note' },
        { id: 'n5', value: 50, label: '50 Dirham', type: 'note' },
        { id: 'n6', value: 20, label: '20 Dirham', type: 'note' },
        { id: 'n7', value: 10, label: '10 Dirham', type: 'note' },
        { id: 'n8', value: 5, label: '5 Dirham', type: 'note' },
        { id: 'c1', value: 1, label: '1 Dirham', type: 'coin' },
        { id: 'c2', value: 0.5, label: '50 Fils', type: 'coin' },
        { id: 'c3', value: 0.25, label: '25 Fils', type: 'coin' },
      ]
    },
    SAR: {
      name: 'Saudi Riyal',
      symbol: 'ر.س',
      denominations: [
        { id: 'n1', value: 500, label: '500 Riyal', type: 'note' },
        { id: 'n2', value: 200, label: '200 Riyal', type: 'note' },
        { id: 'n3', value: 100, label: '100 Riyal', type: 'note' },
        { id: 'n4', value: 50, label: '50 Riyal', type: 'note' },
        { id: 'n5', value: 20, label: '20 Riyal', type: 'note' },
        { id: 'n6', value: 10, label: '10 Riyal', type: 'note' },
        { id: 'n7', value: 5, label: '5 Riyal', type: 'note' },
        { id: 'c1', value: 2, label: '2 Riyal', type: 'coin' },
        { id: 'c2', value: 1, label: '1 Riyal', type: 'coin' },
        { id: 'c3', value: 0.5, label: '50 Halala', type: 'coin' },
        { id: 'c4', value: 0.25, label: '25 Halala', type: 'coin' },
        { id: 'c5', value: 0.1, label: '10 Halala', type: 'coin' },
        { id: 'c6', value: 0.05, label: '5 Halala', type: 'coin' },
      ]
    },
    QAR: {
      name: 'Qatari Riyal',
      symbol: 'ر.ق',
      denominations: [
        { id: 'n1', value: 500, label: '500 Riyal', type: 'note' },
        { id: 'n2', value: 200, label: '200 Riyal', type: 'note' },
        { id: 'n3', value: 100, label: '100 Riyal', type: 'note' },
        { id: 'n4', value: 50, label: '50 Riyal', type: 'note' },
        { id: 'n5', value: 10, label: '10 Riyal', type: 'note' },
        { id: 'n6', value: 5, label: '5 Riyal', type: 'note' },
        { id: 'n7', value: 1, label: '1 Riyal', type: 'note' },
        { id: 'c1', value: 0.5, label: '50 Dirham', type: 'coin' },
        { id: 'c2', value: 0.25, label: '25 Dirham', type: 'coin' },
        { id: 'c3', value: 0.1, label: '10 Dirham', type: 'coin' },
      ]
    },
    KWD: {
      name: 'Kuwaiti Dinar',
      symbol: 'د.ك',
      denominations: [
        { id: 'n1', value: 20, label: '20 Dinar', type: 'note' },
        { id: 'n2', value: 10, label: '10 Dinar', type: 'note' },
        { id: 'n3', value: 5, label: '5 Dinar', type: 'note' },
        { id: 'n4', value: 1, label: '1 Dinar', type: 'note' },
        { id: 'n5', value: 0.5, label: '1/2 Dinar', type: 'note' },
        { id: 'n6', value: 0.25, label: '1/4 Dinar', type: 'note' },
        { id: 'c1', value: 0.1, label: '100 Fils', type: 'coin' },
        { id: 'c2', value: 0.05, label: '50 Fils', type: 'coin' },
        { id: 'c3', value: 0.02, label: '20 Fils', type: 'coin' },
        { id: 'c4', value: 0.01, label: '10 Fils', type: 'coin' },
        { id: 'c5', value: 0.005, label: '5 Fils', type: 'coin' },
      ]
    },
    BHD: {
      name: 'Bahraini Dinar',
      symbol: '.د.ب',
      denominations: [
        { id: 'n1', value: 20, label: '20 Dinar', type: 'note' },
        { id: 'n2', value: 10, label: '10 Dinar', type: 'note' },
        { id: 'n3', value: 5, label: '5 Dinar', type: 'note' },
        { id: 'n4', value: 1, label: '1 Dinar', type: 'note' },
        { id: 'n5', value: 0.5, label: '1/2 Dinar', type: 'note' },
        { id: 'c1', value: 0.5, label: '500 Fils', type: 'coin' },
        { id: 'c2', value: 0.1, label: '100 Fils', type: 'coin' },
        { id: 'c3', value: 0.05, label: '50 Fils', type: 'coin' },
        { id: 'c4', value: 0.025, label: '25 Fils', type: 'coin' },
        { id: 'c5', value: 0.01, label: '10 Fils', type: 'coin' },
        { id: 'c6', value: 0.005, label: '5 Fils', type: 'coin' },
      ]
    }
  };

  const applyTemplate = (templateKey: keyof typeof CURRENCY_TEMPLATES) => {
    const template = CURRENCY_TEMPLATES[templateKey];
    setCode(templateKey);
    setName(template.name);
    setSymbol(template.symbol);
    setDenominations(template.denominations.map(d => ({ 
      ...d, 
      id: Math.random().toString(36).substr(2, 9),
      type: d.type as 'note' | 'coin'
    })));
  };

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [denominations, setDenominations] = useState<Denomination[]>([]);

  useEffect(() => {
    if (!selectedBusiness) return;

    const q = query(
      collection(db, 'currencyConfigs'),
      where('businessId', '==', selectedBusiness.id)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CurrencyConfig));
      setConfigs(list);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'currencyConfigs');
    });

    return () => unsub();
  }, [selectedBusiness]);

  const handleAddDenomination = (type: 'note' | 'coin') => {
    const newDen: Denomination = {
      id: Math.random().toString(36).substr(2, 9),
      value: 0,
      label: '',
      type
    };
    setDenominations([...denominations, newDen]);
  };

  const handleRemoveDenomination = (id: string) => {
    setDenominations(denominations.filter(d => d.id !== id));
  };

  const handleDenominationChange = (id: string, field: keyof Denomination, value: any) => {
    setDenominations(denominations.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  const handleSave = async () => {
    if (!selectedBusiness || !userProfile) return;
    if (!code || !name || !symbol) {
      toast.error('Please fill in all currency details');
      return;
    }

    try {
      const configId = selectedConfig?.id || `${selectedBusiness.id}_${code}`;
      const configData: CurrencyConfig = {
        id: configId,
        code: code.toUpperCase(),
        name,
        symbol,
        denominations: denominations.sort((a, b) => b.value - a.value),
        businessId: selectedBusiness.id,
        ownerId: selectedBusiness.ownerId,
        createdAt: selectedConfig?.createdAt || serverTimestamp()
      };

      await setDoc(doc(db, 'currencyConfigs', configId), configData);
      toast.success('Currency configuration saved');
      setIsEditing(false);
      resetForm();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `currencyConfigs/${selectedConfig?.id || 'new'}`);
      toast.error('Failed to save currency configuration');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this currency configuration?')) return;
    try {
      await deleteDoc(doc(db, 'currencyConfigs', id));
      toast.success('Currency configuration deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `currencyConfigs/${id}`);
      toast.error('Failed to delete currency configuration');
    }
  };

  const resetForm = () => {
    setSelectedConfig(null);
    setCode('');
    setName('');
    setSymbol('');
    setDenominations([]);
  };

  const handleEdit = (config: CurrencyConfig) => {
    setSelectedConfig(config);
    setCode(config.code);
    setName(config.name);
    setSymbol(config.symbol);
    setDenominations(config.denominations);
    setIsEditing(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
            <Globe className="text-blue-500" />
            Currency & Denominations
          </h1>
          <p className="text-slate-500 font-medium mt-1">Manage notes and coins for your business currencies</p>
        </div>
        {!isEditing && (
          <button
            onClick={() => {
              resetForm();
              setIsEditing(true);
            }}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black transition-all shadow-lg shadow-blue-900/20"
          >
            <Plus size={20} />
            Add New Currency
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {isEditing ? (
          <motion.div
            key="form"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#1E293B] border border-slate-800 rounded-3xl p-8 shadow-2xl"
          >
            <div className="mb-8">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Quick Templates</label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(CURRENCY_TEMPLATES).map((key) => (
                  <button
                    key={key}
                    onClick={() => applyTemplate(key as keyof typeof CURRENCY_TEMPLATES)}
                    className="px-4 py-2 bg-slate-900 border border-slate-800 hover:border-blue-500 rounded-xl text-xs font-black text-slate-400 hover:text-blue-500 transition-all"
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Currency Code (e.g. OMR, INR)</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="OMR"
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500 transition-all mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Currency Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Omani Rial"
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500 transition-all mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="RO"
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500 transition-all mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Notes Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <Banknote size={18} className="text-blue-500" />
                    Banknotes
                  </h3>
                  <button
                    onClick={() => handleAddDenomination('note')}
                    className="text-blue-500 hover:text-blue-400 text-xs font-black flex items-center gap-1"
                  >
                    <Plus size={14} /> Add Note
                  </button>
                </div>
                <div className="space-y-3">
                  {denominations.filter(d => d.type === 'note').map((den) => (
                    <DenominationRow
                      key={den.id}
                      denomination={den}
                      onChange={handleDenominationChange}
                      onRemove={handleRemoveDenomination}
                    />
                  ))}
                  {denominations.filter(d => d.type === 'note').length === 0 && (
                    <p className="text-xs text-slate-500 italic text-center py-4">No notes added yet</p>
                  )}
                </div>
              </div>

              {/* Coins Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <Coins size={18} className="text-amber-500" />
                    Coins
                  </h3>
                  <button
                    onClick={() => handleAddDenomination('coin')}
                    className="text-amber-500 hover:text-amber-400 text-xs font-black flex items-center gap-1"
                  >
                    <Plus size={14} /> Add Coin
                  </button>
                </div>
                <div className="space-y-3">
                  {denominations.filter(d => d.type === 'coin').map((den) => (
                    <DenominationRow
                      key={den.id}
                      denomination={den}
                      onChange={handleDenominationChange}
                      onRemove={handleRemoveDenomination}
                    />
                  ))}
                  {denominations.filter(d => d.type === 'coin').length === 0 && (
                    <p className="text-xs text-slate-500 italic text-center py-4">No coins added yet</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-4 mt-12 pt-8 border-t border-slate-800">
              <button
                onClick={() => setIsEditing(false)}
                className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl font-black transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black transition-all shadow-lg shadow-blue-900/20"
              >
                <Save size={20} />
                Save Configuration
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {configs.map((config) => (
              <motion.div
                key={config.id}
                layoutId={config.id}
                className="bg-[#1E293B] border border-slate-800 rounded-3xl p-6 hover:border-blue-500/50 transition-all group"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 font-black text-lg">
                    {config.symbol}
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(config)}
                      className="p-2 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-blue-400 transition-colors"
                    >
                      <Plus size={18} />
                    </button>
                    <button
                      onClick={() => handleDelete(config.id)}
                      className="p-2 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                <h3 className="text-xl font-black text-white">{config.name}</h3>
                <p className="text-sm font-bold text-slate-500">{config.code}</p>
                
                <div className="mt-6 flex items-center gap-4 text-xs font-bold text-slate-400">
                  <div className="flex items-center gap-1">
                    <Banknote size={14} />
                    {config.denominations.filter(d => d.type === 'note').length} Notes
                  </div>
                  <div className="flex items-center gap-1">
                    <Coins size={14} />
                    {config.denominations.filter(d => d.type === 'coin').length} Coins
                  </div>
                </div>

                <button
                  onClick={() => handleEdit(config)}
                  className="w-full mt-6 py-3 bg-slate-900 border border-slate-800 hover:border-blue-500/50 rounded-2xl text-xs font-black text-slate-300 hover:text-blue-400 transition-all"
                >
                  Edit Denominations
                </button>
              </motion.div>
            ))}

            {configs.length === 0 && (
              <div className="col-span-full bg-slate-900/50 border border-dashed border-slate-800 rounded-3xl p-12 text-center">
                <Globe className="w-16 h-16 text-slate-700 mx-auto mb-4" />
                <h2 className="text-xl font-black text-slate-300">No Currencies Configured</h2>
                <p className="text-slate-500 mt-2 max-w-md mx-auto">
                  Add your first currency to start using the cash denomination feature in your portals.
                </p>
                <button
                  onClick={() => setIsEditing(true)}
                  className="mt-6 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black transition-all"
                >
                  Configure Now
                </button>
              </div>
            )}
          </div>
        )}
      </AnimatePresence>
      
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-3xl p-6 flex gap-4">
        <Info className="text-blue-500 shrink-0" />
        <div className="text-sm">
          <p className="font-black text-blue-400 uppercase tracking-widest text-[10px] mb-1">Pro Tip</p>
          <p className="text-slate-400 font-medium">
            Define all common notes and coins for your currency. This will create a "Bank Deposit Slip" style interface for your managers, making cash counting much faster and more accurate.
          </p>
        </div>
      </div>
    </div>
  );
}

function DenominationRow({ 
  denomination, 
  onChange, 
  onRemove 
}: { 
  denomination: Denomination; 
  onChange: (id: string, field: keyof Denomination, value: any) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-2xl p-3 group">
      <div className="flex-1 grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Value</label>
          <input
            type="number"
            value={denomination.value || ''}
            onChange={(e) => onChange(denomination.id, 'value', parseFloat(e.target.value))}
            placeholder="0.00"
            step="0.001"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm font-black text-white outline-none focus:border-blue-500 transition-all"
          />
        </div>
        <div>
          <label className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">Label</label>
          <input
            type="text"
            value={denomination.label}
            onChange={(e) => onChange(denomination.id, 'label', e.target.value)}
            placeholder="e.g. 50 Rial"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm font-black text-white outline-none focus:border-blue-500 transition-all"
          />
        </div>
      </div>
      <button
        onClick={() => onRemove(denomination.id)}
        className="p-2 text-slate-600 hover:text-red-500 transition-colors mt-4"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
