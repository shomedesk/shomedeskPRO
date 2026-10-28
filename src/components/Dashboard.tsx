import React, { useState, useEffect } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { DailyReport } from '@/src/types';
import { TrendingUp, TrendingDown, Wallet, Landmark, ArrowUpRight, ArrowDownRight, Shield, AlertTriangle, Clock, Eye, EyeOff, Building, CreditCard } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { format, differenceInDays, parseISO } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { formatAmount } from '@/src/lib/currencyUtils';

import { currencyService } from '@/src/services/currencyService';

interface BranchDocument {
  id: string;
  name: string;
  documentNumber: string;
  nextRenewalDate: string;
  branchId: string;
}

export default function Dashboard() {
  const { selectedBusiness, isAllBusinessesSelected, businesses, selectedBranch, selectedService, bankAccounts, branches } = useBusiness();
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [expiringDocs, setExpiringDocs] = useState<BranchDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // User requirement: Dashboard default amount hide thakbe, eye button click korle show hobe
  const [isAmountHidden, setIsAmountHidden] = useState<boolean>(() => {
    const saved = localStorage.getItem('sd_hide_amounts');
    return saved !== null ? saved === 'true' : true; // Default is TRUE (hidden)
  });

  const toggleHideAmount = () => {
    setIsAmountHidden(prev => {
      const next = !prev;
      localStorage.setItem('sd_hide_amounts', String(next));
      return next;
    });
  };

  // Filter bank accounts by active business and branch
  const activeBankAccounts = React.useMemo(() => {
    if (isAllBusinessesSelected) {
      return bankAccounts;
    }
    if (selectedBusiness) {
      let filtered = bankAccounts.filter(ba => ba.businessId === selectedBusiness.id || ba.businessId === 'global');
      if (selectedBranch) {
        filtered = filtered.filter(ba => !ba.branchId || ba.branchId === selectedBranch.id);
      }
      return filtered;
    }
    return [];
  }, [bankAccounts, selectedBusiness, isAllBusinessesSelected, selectedBranch]);

  const totalBankAccountsBalance = React.useMemo(() => {
    return activeBankAccounts.reduce((sum, ba) => sum + (Number(ba.balance) || 0), 0);
  }, [activeBankAccounts]);

  useEffect(() => {
    if (!auth.currentUser || (!selectedBusiness && !isAllBusinessesSelected)) return;

    // Fetch expiring documents
    let docQ;
    if (isAllBusinessesSelected) {
      if (businesses.length > 0) {
        docQ = query(collection(db, 'branchDocuments'), where('businessId', 'in', businesses.map(b => b.id).slice(0, 10)));
      }
    } else {
      docQ = query(collection(db, 'branchDocuments'), where('businessId', '==', selectedBusiness!.id));
      if (selectedBranch) {
        docQ = query(docQ, where('branchId', '==', selectedBranch.id));
      }
    }

    let unsubDocs = () => {};
    if (docQ) {
      unsubDocs = onSnapshot(docQ, (snapshot) => {
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as BranchDocument));
        const expiring = docs.filter(d => {
          const days = differenceInDays(parseISO(d.nextRenewalDate), new Date());
          return days <= 30;
        });
        setExpiringDocs(expiring.sort((a, b) => a.nextRenewalDate.localeCompare(b.nextRenewalDate)));
      });
    }

    let q;
    if (isAllBusinessesSelected) {
      if (businesses.length === 0) {
        setLoading(false);
        return;
      }
      q = query(
        collection(db, 'dailyReports'),
        where('businessId', 'in', businesses.map(b => b.id).slice(0, 10)),
        orderBy('date', 'desc'),
        limit(100)
      );
    } else if (selectedBranch) {
      q = query(
        collection(db, 'dailyReports'),
        where('businessId', '==', selectedBusiness!.id),
        where('branchId', '==', selectedBranch.id),
        orderBy('date', 'desc'),
        limit(30)
      );
    } else if (selectedService) {
      q = query(
        collection(db, 'dailyReports'),
        where('businessId', '==', selectedBusiness!.id),
        where('serviceId', '==', selectedService.id),
        orderBy('date', 'desc'),
        limit(30)
      );
    } else {
      q = query(
        collection(db, 'dailyReports'),
        where('businessId', '==', selectedBusiness!.id),
        orderBy('date', 'desc'),
        limit(30)
      );
    }

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const rawData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyReport));
      
      // Only convert currency if there are actually multiple businesses with different currencies
      let data = rawData;
      const uniqueCurrencies = new Set(businesses.map(b => b.currency || 'OMR'));
      if (isAllBusinessesSelected && uniqueCurrencies.size > 1) {
        data = await Promise.all(rawData.map(async (report) => {
          const business = businesses.find(b => b.id === report.businessId);
          const reportCurrency = business?.currency || 'OMR';
          
          return {
            ...report,
            cashSale: await currencyService.convertToINR(report.cashSale, reportCurrency),
            bankSale: await currencyService.convertToINR(report.bankSale, reportCurrency),
            cashExpense: await currencyService.convertToINR(report.cashExpense, reportCurrency),
            bankExpense: await currencyService.convertToINR(report.bankExpense, reportCurrency),
            bankToCash: await currencyService.convertToINR(report.bankToCash || 0, reportCurrency),
            cashToBank: await currencyService.convertToINR(report.cashToBank || 0, reportCurrency),
            closingCash: await currencyService.convertToINR(report.closingCash, reportCurrency),
            closingBank: await currencyService.convertToINR(report.closingBank, reportCurrency),
          };
        }));
      }

      if (!selectedBranch || isAllBusinessesSelected) {
        // Aggregate reports by date
        const aggregated: { [date: string]: DailyReport } = {};
        data.forEach(report => {
          const date = report.date.split('T')[0];
          if (!aggregated[date]) {
            aggregated[date] = { ...report, bankToCash: report.bankToCash || 0, cashToBank: report.cashToBank || 0 };
          } else {
            aggregated[date].cashSale += report.cashSale;
            aggregated[date].bankSale += report.bankSale;
            aggregated[date].cashExpense += report.cashExpense;
            aggregated[date].bankExpense += report.bankExpense;
            aggregated[date].bankToCash = (aggregated[date].bankToCash || 0) + (report.bankToCash || 0);
            aggregated[date].cashToBank = (aggregated[date].cashToBank || 0) + (report.cashToBank || 0);
            aggregated[date].closingCash += report.closingCash;
            aggregated[date].closingBank += report.closingBank;
          }
        });
        setReports(Object.values(aggregated).sort((a, b) => b.date.localeCompare(a.date)));
      } else {
        setReports(data);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'dailyReports');
      setLoading(false);
    });

    return () => {
      unsubscribe();
      unsubDocs();
    };
  }, [selectedBusiness, isAllBusinessesSelected, businesses, selectedBranch]);

  const latestReport = reports[0];
  const profit = latestReport ? (latestReport.cashSale + latestReport.bankSale) - (latestReport.cashExpense + latestReport.bankExpense) : 0;
  const uniqueCurrencies = new Set(businesses.map(b => b.currency || 'OMR'));
  const currency = (isAllBusinessesSelected && uniqueCurrencies.size > 1) 
    ? '₹' 
    : (selectedBusiness?.currency || businesses[0]?.currency || 'OMR');

  const chartData = reports.slice().reverse().map(r => ({
    date: format(new Date(r.date), 'MMM dd'),
    profit: (r.cashSale + r.bankSale) - (r.cashExpense + r.bankExpense),
    cash: r.closingCash,
    bank: r.closingBank
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Top Header Bar with Amount Masking Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#1E293B] p-4 md:p-5 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg md:text-xl font-black text-white tracking-tight uppercase">Executive Dashboard</h1>
            <span className="text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
              {isAllBusinessesSelected ? 'Global' : (selectedBranch?.name || selectedBusiness?.name || 'Overview')}
            </span>
          </div>
          <p className="text-[10px] md:text-xs text-slate-400 font-medium mt-0.5">
            Real-time liquidity, bank accounts, profit analytics & branch activities
          </p>
        </div>

        {/* User Eye Button Toggle for Financial Privacy */}
        <button
          onClick={toggleHideAmount}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-black transition-all border cursor-pointer active:scale-95 shadow-md",
            isAmountHidden
              ? "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
              : "bg-blue-600 text-white border-blue-500 hover:bg-blue-500 shadow-blue-900/30"
          )}
          title={isAmountHidden ? "Click to Show All Financial Amounts" : "Click to Hide All Financial Amounts"}
        >
          {isAmountHidden ? (
            <>
              <Eye size={16} className="text-amber-400 animate-pulse" />
              <span>Show Balances</span>
            </>
          ) : (
            <>
              <EyeOff size={16} className="text-white" />
              <span>Hide Balances</span>
            </>
          )}
        </button>
      </div>

      {expiringDocs.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 p-4 md:p-6 rounded-2xl md:rounded-3xl">
          <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
            <div className="p-1.5 md:p-2 bg-amber-500/20 rounded-lg md:rounded-xl text-amber-500">
              <AlertTriangle size={16} className="md:w-5 md:h-5" />
            </div>
            <div>
              <h3 className="text-[10px] md:text-sm font-black text-amber-500 uppercase tracking-widest">Renewal Alerts</h3>
              <p className="text-[8px] md:text-[10px] text-amber-500/70 font-bold uppercase tracking-widest">Documents expiring within 30 days</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {expiringDocs.map(doc => {
              const days = differenceInDays(parseISO(doc.nextRenewalDate), new Date());
              return (
                <div key={doc.id} className="bg-slate-900/50 p-3 md:p-4 rounded-xl md:rounded-2xl border border-amber-500/10 flex justify-between items-center">
                  <div className="overflow-hidden">
                    <p className="text-[10px] md:text-xs font-black text-white uppercase tracking-tight truncate">{doc.name}</p>
                    <p className="text-[8px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">ID: {doc.documentNumber}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className={cn("text-[10px] md:text-xs font-black", days < 0 ? "text-red-500" : "text-amber-500")}>
                      {days < 0 ? 'EXPIRED' : `${days}d`}
                    </p>
                    <p className="text-[8px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      {format(parseISO(doc.nextRenewalDate), 'MMM dd')}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Profit / Loss"
          value={profit}
          currency={currency}
          isAmountHidden={isAmountHidden}
          icon={profit >= 0 ? <TrendingUp size={16} className="md:w-5 md:h-5" /> : <TrendingDown size={16} className="md:w-5 md:h-5" />}
          color={profit >= 0 ? "text-emerald-400" : "text-rose-400"}
          bg="bg-emerald-500/10"
          border="border-emerald-500/20"
        />
        <StatCard
          label="Cash in Hand"
          value={latestReport?.closingCash || 0}
          currency={currency}
          isAmountHidden={isAmountHidden}
          icon={<Wallet size={16} className="md:w-5 md:h-5" />}
          color="text-amber-400"
          bg="bg-amber-500/10"
          border="border-amber-500/20"
        />
        <StatCard
          label="Bank Balance"
          value={latestReport?.closingBank !== undefined ? latestReport.closingBank : totalBankAccountsBalance}
          currency={currency}
          isAmountHidden={isAmountHidden}
          icon={<Landmark size={16} className="md:w-5 md:h-5" />}
          color="text-blue-400"
          bg="bg-blue-500/10"
          border="border-blue-500/20"
        />
        <StatCard
          label="Total Liquidity"
          value={(latestReport?.closingCash || 0) + (latestReport?.closingBank !== undefined ? latestReport.closingBank : totalBankAccountsBalance)}
          currency={currency}
          isAmountHidden={isAmountHidden}
          icon={<ArrowUpRight size={16} className="md:w-5 md:h-5" />}
          color="text-indigo-400"
          bg="bg-indigo-500/10"
          border="border-indigo-500/20"
        />
      </div>

      {/* Dedicated Bank Accounts Breakdown Section (Kon bank ee koto achee taoo clear dekhiye dao) */}
      <div className="bg-[#1E293B] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
              <Landmark size={18} />
            </div>
            <div>
              <h3 className="text-xs md:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                Bank Account Balances
                <span className="text-[10px] font-bold bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                  {activeBankAccounts.length} {activeBankAccounts.length === 1 ? 'Account' : 'Accounts'}
                </span>
              </h3>
              <p className="text-[9px] md:text-[10px] text-slate-400 font-medium">
                Live balances for company, branch & card settlement bank accounts
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Total in Banks</p>
            <p className="text-sm md:text-base font-black font-mono text-blue-400">
              {isAmountHidden ? '••••••' : `${currency} ${formatAmount(totalBankAccountsBalance, currency)}`}
            </p>
          </div>
        </div>

        {activeBankAccounts.length === 0 ? (
          <div className="p-8 text-center text-slate-500 font-bold uppercase tracking-widest text-[10px] md:text-xs bg-slate-900/30 rounded-2xl border border-slate-800/50">
            No bank accounts configured for this branch/business. Go to Finance to add bank accounts.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {activeBankAccounts.map((ba) => {
              const bankCurr = ba.currency || currency;
              const branchInfo = branches.find(b => b.id === ba.branchId);
              const isCardBank = ba.bankName.toLowerCase().includes('card') || ba.accountName.toLowerCase().includes('card') || ba.accountName.toLowerCase().includes('pos');
              const isOnlineBank = ba.bankName.toLowerCase().includes('online') || ba.accountName.toLowerCase().includes('online');

              return (
                <div 
                  key={ba.id} 
                  className="bg-slate-900/70 hover:bg-slate-900 p-3.5 md:p-4 rounded-xl md:rounded-2xl border border-slate-800/80 hover:border-blue-500/30 transition-all shadow-md flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 overflow-hidden">
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-white text-xs md:text-sm tracking-tight truncate">
                          {ba.bankName}
                        </span>
                        {isCardBank && (
                          <span className="text-[9px] font-bold bg-amber-500/10 text-amber-400 px-1.5 py-0.2 rounded border border-amber-500/20">
                            CARD
                          </span>
                        )}
                        {isOnlineBank && (
                          <span className="text-[9px] font-bold bg-sky-500/10 text-sky-400 px-1.5 py-0.2 rounded border border-sky-500/20">
                            ONLINE
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] md:text-xs text-slate-400 font-medium truncate">
                        {ba.accountName}
                      </p>
                      <p className="text-[9px] font-mono text-slate-500">
                        A/C: {ba.accountNumber ? `•••• ${ba.accountNumber.slice(-4)}` : '•••• Primary'}
                      </p>
                    </div>

                    <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg shrink-0">
                      <CreditCard size={16} />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-end justify-between">
                    <div>
                      <span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-slate-500">
                        {branchInfo ? branchInfo.name : (ba.businessId === 'global' ? 'Company Central' : 'Branch Account')}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-sm md:text-base font-black font-mono text-emerald-400">
                        {isAmountHidden ? '••••••' : `${bankCurr} ${formatAmount(ba.balance || 0, bankCurr)}`}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 30-Day Trend Chart */}
      <div className="bg-[#1E293B] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl">
        <h3 className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4 md:mb-6">Profit Trend (30 Days)</h3>
        <div className="h-48 md:h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
              <XAxis dataKey="date" stroke="#64748B" fontSize={8} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748B" fontSize={8} tickLine={false} axisLine={false} tickFormatter={(v) => isAmountHidden ? '•••' : `${currency}${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: '12px', fontSize: '10px' }}
                itemStyle={{ color: '#F8FAFC' }}
                formatter={(value: any) => [isAmountHidden ? '••••••' : `${currency} ${formatAmount(Number(value) || 0, currency)}`, 'Profit']}
              />
              <Area type="monotone" dataKey="profit" stroke="#3B82F6" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-[#1E293B] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl">
        <h3 className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-3 md:mb-4">Recent Activity</h3>
        <div className="space-y-2 md:space-y-4">
          {reports.slice(0, 5).map((r) => (
            <div key={r.id} className="flex justify-between items-center p-2.5 md:p-3 bg-slate-900/50 rounded-xl md:rounded-2xl border border-slate-800">
              <div>
                <p className="text-xs md:text-sm font-bold text-slate-200">{format(new Date(r.date), 'MMM dd, yyyy')}</p>
                <p className="text-[8px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider">Daily Report Submitted</p>
              </div>
              <div className="text-right">
                <p className={cn("text-xs md:text-sm font-black font-mono", (r.cashSale + r.bankSale - r.cashExpense - r.bankExpense) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {isAmountHidden ? '••••••' : `${currency} ${formatAmount(r.cashSale + r.bankSale - r.cashExpense - r.bankExpense, currency)}`}
                </p>
              </div>
            </div>
          ))}
          {reports.length === 0 && (
            <div className="p-8 md:p-12 text-center text-slate-500 font-bold uppercase tracking-widest text-[10px] md:text-xs">
              No recent activity
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  currency, 
  icon, 
  color, 
  bg, 
  border,
  isAmountHidden = false 
}: { 
  label: string; 
  value: number; 
  currency: string; 
  icon: React.ReactNode; 
  color: string; 
  bg: string; 
  border: string;
  isAmountHidden?: boolean;
}) {
  return (
    <div className={cn("p-3 md:p-5 rounded-2xl md:rounded-3xl border shadow-lg transition-all hover:scale-[1.02]", bg, border)}>
      <div className={cn("mb-2 md:mb-3 p-1.5 md:p-2 w-fit rounded-lg md:rounded-xl bg-white/5", color)}>
        {icon}
      </div>
      <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5 md:mb-1">{label}</p>
      <p className={cn("text-sm md:text-xl font-black font-mono tracking-tight", color)}>
        {isAmountHidden ? '••••••' : `${currency} ${formatAmount(value, currency)}`}
      </p>
    </div>
  );
}
