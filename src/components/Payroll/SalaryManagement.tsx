import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, Timestamp, getDocs } from 'firebase/firestore';
import { DollarSign, Plus, CheckCircle, XCircle, Clock, User, FileText, AlertCircle, X, Calculator, Printer, Download, CreditCard, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBusiness } from '../../contexts/BusinessContext';
import { cn } from '../../lib/utils';
import { createNotification } from '../../lib/notification-utils';
import { Employee, SalaryRequest, Transaction } from '../../types';
import { downloadElementAsPdf } from '../../lib/pdfUtils';
import { toast } from 'sonner';
import { runTransaction } from 'firebase/firestore';

export const SalaryManagement: React.FC = () => {
  const { userProfile, selectedBusiness, branches, bankAccounts } = useBusiness();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaryRequests, setSalaryRequests] = useState<SalaryRequest[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [viewingSlip, setViewingSlip] = useState<SalaryRequest | null>(null);
  const [processingRequest, setProcessingRequest] = useState<SalaryRequest | null>(null);
  const slipRef = useRef<HTMLDivElement>(null);
  const statementRef = useRef<HTMLDivElement>(null);
  
  const currency = selectedBusiness?.currency || 'INR';

  const [paymentData, setPaymentData] = useState({
    paymentType: 'cash' as 'cash' | 'bank' | 'split',
    cashAmount: 0,
    bankAmount: 0,
    sourceAccountId: '',
    destinationType: 'cash' as 'cash' | 'bank',
  });

  const [statementFilter, setStatementFilter] = useState({
    employeeId: 'all',
    month: 'all',
    year: new Date().getFullYear().toString(),
  });

  const [formData, setFormData] = useState({
    month: new Date().toLocaleString('default', { month: 'long' }),
    year: new Date().getFullYear(),
    allowances: 0,
    overtime: 0,
    bonuses: 0,
    deductions: 0,
    adjustmentNote: '',
  });

  useEffect(() => {
    if (!userProfile?.businessId) return;

    // Fetch employees
    let empQ = query(collection(db, 'employees'), where('businessId', '==', userProfile.businessId), where('status', '==', 'active'));
    if (userProfile.role === 'manager' && userProfile.branchId) {
      empQ = query(empQ, where('branchId', '==', userProfile.branchId));
    }

    const unsubEmployees = onSnapshot(empQ, (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
    });

    // Fetch salary requests
    let salaryQ = query(collection(db, 'salaryRequests'), where('businessId', '==', userProfile.businessId));
    if (userProfile.role === 'manager' && userProfile.branchId) {
      salaryQ = query(salaryQ, where('branchId', '==', userProfile.branchId));
    }

    const unsubSalaries = onSnapshot(salaryQ, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SalaryRequest));
      setSalaryRequests(data.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds));
    });

    return () => {
      unsubEmployees();
      unsubSalaries();
    };
  }, [userProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile?.businessId || !selectedEmployee) return;

    const netSalary = selectedEmployee.baseSalary + formData.allowances + formData.overtime + formData.bonuses - formData.deductions;

    const requestData = {
      ...formData,
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      baseSalary: selectedEmployee.baseSalary,
      netSalary,
      businessId: userProfile.businessId,
      branchId: selectedEmployee.branchId,
      status: 'pending',
      createdAt: Timestamp.now(),
    };

    try {
      await addDoc(collection(db, 'salaryRequests'), requestData);
      
      await createNotification(
        userProfile.businessId,
        'New Salary Request',
        `Salary request submitted for ${selectedEmployee.name} (${formData.month} ${formData.year})`,
        'salary_request',
        undefined,
        '/payroll'
      );

      setIsModalOpen(false);
      setSelectedEmployee(null);
      setFormData({
        month: new Date().toLocaleString('default', { month: 'long' }),
        year: new Date().getFullYear(),
        allowances: 0,
        overtime: 0,
        bonuses: 0,
        deductions: 0,
        adjustmentNote: '',
      });
    } catch (error) {
      console.error('Error submitting salary request:', error);
    }
  };

  const handleStatusUpdate = async (id: string, status: SalaryRequest['status']) => {
    if (status === 'paid') {
      const request = salaryRequests.find(r => r.id === id);
      if (request) {
        setProcessingRequest(request);
        setIsPaymentModalOpen(true);
      }
      return;
    }

    try {
      await updateDoc(doc(db, 'salaryRequests', id), { 
        status,
        processedBy: userProfile?.uid,
      });
      toast.success(`Salary request ${status}`);
    } catch (error) {
      console.error('Error updating salary status:', error);
      toast.error('Failed to update status');
    }
  };

  const processPayment = async () => {
    if (!processingRequest || !userProfile?.businessId) return;
    
    if (paymentData.paymentType === 'bank' && !paymentData.sourceAccountId) {
      toast.error('Please select a source bank account');
      return;
    }

    if (paymentData.paymentType === 'split') {
      if (!paymentData.sourceAccountId) {
        toast.error('Please select a source bank account for the bank portion');
        return;
      }
      if (paymentData.cashAmount + paymentData.bankAmount !== processingRequest.netSalary) {
        toast.error(`Total split amount (${paymentData.cashAmount + paymentData.bankAmount}) must equal net salary (${processingRequest.netSalary})`);
        return;
      }
    }

    try {
      await runTransaction(db, async (transaction) => {
        const salaryRef = doc(db, 'salaryRequests', processingRequest.id);
        
        // 1. Update Salary Request
        transaction.update(salaryRef, {
          status: 'paid',
          paymentType: paymentData.paymentType,
          cashAmount: paymentData.paymentType === 'split' ? paymentData.cashAmount : (paymentData.paymentType === 'cash' ? processingRequest.netSalary : 0),
          bankAmount: paymentData.paymentType === 'split' ? paymentData.bankAmount : (paymentData.paymentType === 'bank' ? processingRequest.netSalary : 0),
          sourceAccountId: paymentData.sourceAccountId,
          destinationType: paymentData.destinationType,
          paymentDate: new Date().toISOString(),
          processedBy: userProfile.uid
        });

        // 2. Create Transaction Records
        if (paymentData.paymentType === 'cash' || paymentData.paymentType === 'split') {
          const cashAmt = paymentData.paymentType === 'split' ? paymentData.cashAmount : processingRequest.netSalary;
          if (cashAmt > 0) {
            const transRef = doc(collection(db, 'transactions'));
            transaction.set(transRef, {
              businessId: userProfile.businessId,
              ownerId: selectedBusiness?.ownerId || userProfile.uid,
              branchId: processingRequest.branchId,
              userId: userProfile.uid,
              type: 'expense',
              amount: cashAmt,
              category: 'Salary',
              description: `Salary Payment (Cash) for ${processingRequest.employeeName} (${processingRequest.month} ${processingRequest.year})`,
              date: new Date().toISOString().split('T')[0],
              createdAt: Timestamp.now(),
              fromAccount: 'cash'
            });
          }
        }

        if (paymentData.paymentType === 'bank' || paymentData.paymentType === 'split') {
          const bankAmt = paymentData.paymentType === 'split' ? paymentData.bankAmount : processingRequest.netSalary;
          if (bankAmt > 0) {
            const transRef = doc(collection(db, 'transactions'));
            transaction.set(transRef, {
              businessId: userProfile.businessId,
              ownerId: selectedBusiness?.ownerId || userProfile.uid,
              branchId: processingRequest.branchId,
              userId: userProfile.uid,
              type: 'expense',
              amount: bankAmt,
              category: 'Salary',
              description: `Salary Payment (Bank) for ${processingRequest.employeeName} (${processingRequest.month} ${processingRequest.year})`,
              date: new Date().toISOString().split('T')[0],
              createdAt: Timestamp.now(),
              fromAccount: 'bank',
              fromBankId: paymentData.sourceAccountId
            });

            // Update Bank Balance
            const bankRef = doc(db, 'bankAccounts', paymentData.sourceAccountId);
            const bankSnap = await transaction.get(bankRef);
            if (bankSnap.exists()) {
              const currentBalance = bankSnap.data().balance || 0;
              transaction.update(bankRef, { balance: currentBalance - bankAmt });
            }
          }
        }
      });

      toast.success('Salary paid and balance adjusted');
      setIsPaymentModalOpen(false);
      setProcessingRequest(null);
    } catch (error) {
      console.error('Error processing payment:', error);
      toast.error('Failed to process payment');
    }
  };

  const printStatement = () => {
    if (statementRef.current) {
      const empName = statementFilter.employeeId === 'all' ? 'All_Employees' : (employees.find(e => e.id === statementFilter.employeeId)?.name || 'Employee');
      downloadElementAsPdf(statementRef.current, `Payroll_Statement_${empName}_${statementFilter.month}_${statementFilter.year}.pdf`);
    } else {
      toast.error('Statement not ready for download');
    }
  };

  const printSlip = () => {
    if (slipRef.current) {
      downloadElementAsPdf(slipRef.current, `Salary_Slip_${viewingSlip?.employeeName || 'Staff'}.pdf`);
    } else {
      toast.error('Salary slip not ready for download');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'text-emerald-500 bg-emerald-500/10';
      case 'approved': return 'text-blue-500 bg-blue-500/10';
      case 'rejected': return 'text-red-500 bg-red-500/10';
      default: return 'text-amber-500 bg-amber-500/10';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter">Salary Management</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Process payroll and payments</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Employee List for Quick Request */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest px-2">Active Employees</h3>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {employees.map(emp => (
              <button
                key={emp.id}
                onClick={() => {
                  if (userProfile?.role === 'accountant') return;
                  setSelectedEmployee(emp);
                  setIsModalOpen(true);
                }}
                disabled={userProfile?.role === 'accountant'}
                className={cn(
                  "w-full bg-[#1E293B] p-4 rounded-2xl border border-slate-800 hover:border-blue-500/50 transition-all text-left flex items-center justify-between group",
                  userProfile?.role === 'accountant' && "cursor-default hover:border-slate-800"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-900 rounded-xl text-slate-400 group-hover:text-blue-500 transition-colors">
                    <User size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-black text-white uppercase tracking-tight">{emp.name}</div>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Base: {currency} {emp.baseSalary.toLocaleString()}</div>
                  </div>
                </div>
                {userProfile?.role !== 'accountant' && <Plus size={18} className="text-slate-600 group-hover:text-blue-500" />}
              </button>
            ))}
          </div>
        </div>

        {/* Salary Requests List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Payroll History & Requests</h3>
            
            <div className="flex flex-wrap gap-2">
              <button
                onClick={printStatement}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-blue-900/20"
              >
                <Printer size={12} />
                Print Statement
              </button>
              <select
                value={statementFilter.employeeId}
                onChange={(e) => setStatementFilter({ ...statementFilter, employeeId: e.target.value })}
                className="bg-[#1E293B] border border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black text-white outline-none focus:border-blue-500"
              >
                <option value="all">All Employees</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
              <select
                value={statementFilter.month}
                onChange={(e) => setStatementFilter({ ...statementFilter, month: e.target.value })}
                className="bg-[#1E293B] border border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black text-white outline-none focus:border-blue-500"
              >
                <option value="all">All Months</option>
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select
                value={statementFilter.year}
                onChange={(e) => setStatementFilter({ ...statementFilter, year: e.target.value })}
                className="bg-[#1E293B] border border-slate-800 rounded-xl px-3 py-1.5 text-[10px] font-black text-white outline-none focus:border-blue-500"
              >
                {Array.from({ length: 11 }, (_, i) => 2026 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-4" ref={statementRef}>
            <AnimatePresence mode="popLayout">
              {salaryRequests
                .filter(r => {
                  const empMatch = statementFilter.employeeId === 'all' || r.employeeId === statementFilter.employeeId;
                  const monthMatch = statementFilter.month === 'all' || r.month === statementFilter.month;
                  const yearMatch = r.year.toString() === statementFilter.year;
                  return empMatch && monthMatch && yearMatch;
                })
                .map((request) => (
                <motion.div
                  key={request.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl"
                >
                  <div className="flex flex-col md:flex-row justify-between gap-6">
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-slate-900 rounded-2xl text-emerald-500">
                        <DollarSign size={24} />
                      </div>
                      <div>
                        <h3 className="font-black text-white uppercase tracking-tight">{request.employeeName}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-slate-900 px-2 py-0.5 rounded">
                            {request.month} {request.year}
                          </span>
                          <span className={cn("text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest", getStatusColor(request.status))}>
                            {request.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-8">
                      <div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Base Salary</span>
                        <div className="text-sm font-black text-white">{currency} {request.baseSalary.toLocaleString()}</div>
                      </div>
                      <div>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Total Net</span>
                        <div className="text-lg font-black text-white">{currency} {request.netSalary.toLocaleString()}</div>
                      </div>
                      <div className="flex items-end justify-end">
                        <button
                          onClick={() => setViewingSlip(request)}
                          className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-800"
                        >
                          <FileText size={14} />
                          View Slip
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 pt-6 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {request.status === 'paid' && (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
                            {request.paymentType === 'bank' ? <CreditCard size={12} className="text-blue-500" /> : 
                             request.paymentType === 'split' ? <Calculator size={12} className="text-amber-500" /> :
                             <Wallet size={12} className="text-emerald-500" />}
                            Paid via {request.paymentType === 'bank' ? 'Bank' : request.paymentType === 'split' ? 'Split (Cash+Bank)' : 'Cash'}
                            {request.paymentDate && <span className="ml-2 text-slate-600">on {new Date(request.paymentDate).toLocaleDateString()}</span>}
                          </div>
                          {request.paymentType === 'split' && (
                            <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest ml-2">
                              Cash: {currency} {request.cashAmount?.toLocaleString()} | Bank: {currency} {request.bankAmount?.toLocaleString()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-3">
                      {request.status === 'pending' && (userProfile?.role === 'admin' || userProfile?.role === 'manager') && (
                        <>
                          <button
                            onClick={() => handleStatusUpdate(request.id, 'approved')}
                            className="flex items-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                          >
                            <CheckCircle size={14} />
                            Approve
                          </button>
                          <button
                            onClick={() => handleStatusUpdate(request.id, 'rejected')}
                            className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                          >
                            <XCircle size={14} />
                            Reject
                          </button>
                        </>
                      )}
                      {(request.status === 'approved' || (request.status === 'pending' && userProfile?.role === 'admin')) && (
                        <button
                          onClick={() => handleStatusUpdate(request.id, 'paid')}
                          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
                        >
                          <DollarSign size={14} />
                          Pay Now
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Salary Process Modal */}
      <AnimatePresence>
        {isModalOpen && selectedEmployee && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-xl text-blue-500">
                    <Calculator size={20} />
                  </div>
                  <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter">Process Salary</h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 mb-4">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Employee</div>
                  <div className="text-lg font-black text-white uppercase tracking-tight">{selectedEmployee.name}</div>
                  <div className="text-xs font-bold text-blue-500 mt-1">Base Salary: {currency} {selectedEmployee.baseSalary.toLocaleString()}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Month</label>
                    <select
                      value={formData.month}
                      onChange={(e) => setFormData({ ...formData, month: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    >
                      {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Year</label>
                    <input
                      type="number"
                      value={formData.year}
                      onChange={(e) => setFormData({ ...formData, year: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Allowances (+)</label>
                    <input
                      type="number"
                      value={formData.allowances}
                      min={0}
                      max={1000000000}
                      onChange={(e) => setFormData({ ...formData, allowances: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Overtime (+)</label>
                    <input
                      type="number"
                      value={formData.overtime}
                      min={0}
                      max={1000000000}
                      onChange={(e) => setFormData({ ...formData, overtime: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Bonuses (+)</label>
                    <input
                      type="number"
                      value={formData.bonuses}
                      min={0}
                      max={1000000000}
                      onChange={(e) => setFormData({ ...formData, bonuses: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-red-500 uppercase tracking-widest">Deductions (-)</label>
                    <input
                      type="number"
                      value={formData.deductions}
                      min={0}
                      max={1000000000}
                      onChange={(e) => setFormData({ ...formData, deductions: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Adjustment Note</label>
                  <textarea
                    value={formData.adjustmentNote}
                    onChange={(e) => setFormData({ ...formData, adjustmentNote: e.target.value })}
                    maxLength={500}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold min-h-[80px]"
                    placeholder="Reason for adjustments..."
                  />
                </div>

                <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 flex justify-between items-center mt-4">
                  <span className="text-xs font-black text-blue-500 uppercase tracking-widest">Total Net Salary</span>
                  <span className="text-xl font-black text-white">
                    {currency} {(selectedEmployee.baseSalary + formData.allowances + formData.overtime + formData.bonuses - formData.deductions).toLocaleString()}
                  </span>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 shadow-lg shadow-blue-500/20 mt-4"
                >
                  Submit Salary Request
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Payment Processing Modal */}
      <AnimatePresence>
        {isPaymentModalOpen && processingRequest && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] w-full max-w-md rounded-3xl border border-slate-800 shadow-2xl overflow-hidden"
            >
              <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-500">
                    <DollarSign size={20} />
                  </div>
                  <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter">Complete Payment</h3>
                </div>
                <button onClick={() => setIsPaymentModalOpen(false)} className="text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <div className="p-4 md:p-6 space-y-4 md:space-y-6">
                <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Paying To</div>
                  <div className="text-lg font-black text-white uppercase tracking-tight">{processingRequest.employeeName}</div>
                  <div className="text-xl font-black text-emerald-500 mt-1">{currency} {processingRequest.netSalary.toLocaleString()}</div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Source Account (From)</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setPaymentData({ ...paymentData, paymentType: 'cash', sourceAccountId: '' })}
                        className={cn(
                          "flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all",
                          paymentData.paymentType === 'cash' 
                            ? "bg-blue-600 border-blue-500 text-white" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        )}
                      >
                        <Wallet size={16} />
                        Cash
                      </button>
                      <button
                        onClick={() => setPaymentData({ ...paymentData, paymentType: 'bank' })}
                        className={cn(
                          "flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all",
                          paymentData.paymentType === 'bank' 
                            ? "bg-blue-600 border-blue-500 text-white" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        )}
                      >
                        <CreditCard size={16} />
                        Bank
                      </button>
                      <button
                        onClick={() => setPaymentData({ ...paymentData, paymentType: 'split', cashAmount: 0, bankAmount: processingRequest.netSalary })}
                        className={cn(
                          "flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all",
                          paymentData.paymentType === 'split' 
                            ? "bg-blue-600 border-blue-500 text-white" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        )}
                      >
                        <Calculator size={16} />
                        Split
                      </button>
                    </div>
                  </div>

                  {paymentData.paymentType === 'split' && (
                    <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Cash Amount</label>
                        <input
                          type="number"
                          value={paymentData.cashAmount}
                          min={0}
                          max={1000000000}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPaymentData({ 
                              ...paymentData, 
                              cashAmount: val, 
                              bankAmount: Math.max(0, (processingRequest?.netSalary || 0) - val) 
                            });
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Bank Amount</label>
                        <input
                          type="number"
                          value={paymentData.bankAmount}
                          min={0}
                          max={1000000000}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setPaymentData({ 
                              ...paymentData, 
                              bankAmount: val, 
                              cashAmount: Math.max(0, (processingRequest?.netSalary || 0) - val) 
                            });
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        />
                      </div>
                    </div>
                  )}

                  {(paymentData.paymentType === 'bank' || paymentData.paymentType === 'split') && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        {paymentData.paymentType === 'split' ? 'Select Bank Account (for bank portion)' : 'Select Bank Account'}
                      </label>
                      <select
                        value={paymentData.sourceAccountId}
                        onChange={(e) => setPaymentData({ ...paymentData, sourceAccountId: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                      >
                        <option value="">Select Account</option>
                        {bankAccounts.map(acc => (
                          <option key={acc.id} value={acc.id}>{acc.bankName} - {acc.accountNumber} ({currency} {acc.balance.toLocaleString()})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Destination (To Employee)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setPaymentData({ ...paymentData, destinationType: 'cash' })}
                        className={cn(
                          "flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all",
                          paymentData.destinationType === 'cash' 
                            ? "bg-emerald-600 border-emerald-500 text-white" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        )}
                      >
                        <Wallet size={16} />
                        Cash
                      </button>
                      <button
                        onClick={() => setPaymentData({ ...paymentData, destinationType: 'bank' })}
                        className={cn(
                          "flex items-center justify-center gap-2 p-3 rounded-xl border font-bold text-xs transition-all",
                          paymentData.destinationType === 'bank' 
                            ? "bg-emerald-600 border-emerald-500 text-white" 
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        )}
                      >
                        <CreditCard size={16} />
                        Bank
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  onClick={processPayment}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 shadow-lg shadow-emerald-500/20 mt-4"
                >
                  Confirm & Pay
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Salary Slip Modal */}
      <AnimatePresence>
        {viewingSlip && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Salary Slip</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={printSlip}
                    className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all"
                  >
                    <Printer size={20} />
                  </button>
                  <button onClick={() => setViewingSlip(null)} className="text-slate-400 hover:text-slate-600">
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div ref={slipRef} className="p-8 overflow-y-auto flex-1 text-slate-900">
                <div className="text-center mb-8">
                  <h1 className="text-2xl font-black uppercase tracking-tighter text-blue-600">{selectedBusiness?.name}</h1>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Salary Slip for {viewingSlip.month} {viewingSlip.year}</p>
                </div>

                <div className="grid grid-cols-2 gap-8 mb-8 pb-8 border-b border-slate-100">
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Employee Details</div>
                    <div className="text-lg font-black uppercase tracking-tight">{viewingSlip.employeeName}</div>
                    <div className="text-xs font-bold text-slate-500 mt-1">Branch: {branches.find(b => b.id === viewingSlip.branchId)?.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Payment Status</div>
                    <div className={cn("text-sm font-black uppercase tracking-widest", viewingSlip.status === 'paid' ? "text-emerald-600" : "text-amber-600")}>
                      {viewingSlip.status}
                    </div>
                    {viewingSlip.paymentType && (
                      <div className="text-[10px] font-bold text-slate-500 mt-1 uppercase">
                        Method: {viewingSlip.paymentType}
                        {viewingSlip.paymentType === 'split' && (
                          <span className="ml-1 text-slate-400">
                            (Cash: {currency} {viewingSlip.cashAmount?.toLocaleString()}, Bank: {currency} {viewingSlip.bankAmount?.toLocaleString()})
                          </span>
                        )}
                      </div>
                    )}
                    {viewingSlip.paymentDate && (
                      <div className="text-[10px] font-bold text-slate-500 mt-1">Date: {new Date(viewingSlip.paymentDate).toLocaleDateString()}</div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Base Salary</span>
                    <span className="font-black">{currency} {viewingSlip.baseSalary.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Allowances</span>
                    <span className="font-black text-emerald-600">+ {currency} {(viewingSlip.allowances || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Overtime</span>
                    <span className="font-black text-emerald-600">+ {currency} {(viewingSlip.overtime || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Bonuses</span>
                    <span className="font-black text-emerald-600">+ {currency} {viewingSlip.bonuses.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-50">
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Deductions</span>
                    <span className="font-black text-red-600">- {currency} {viewingSlip.deductions.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center py-4 bg-slate-50 px-4 rounded-2xl mt-6">
                    <span className="text-sm font-black text-slate-900 uppercase tracking-widest">Net Payable</span>
                    <span className="text-xl font-black text-blue-600">{currency} {viewingSlip.netSalary.toLocaleString()}</span>
                  </div>
                </div>

                {viewingSlip.adjustmentNote && (
                  <div className="mt-8 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                    <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Remarks</div>
                    <p className="text-xs font-bold text-amber-800 leading-relaxed">{viewingSlip.adjustmentNote}</p>
                  </div>
                )}

                <div className="mt-12 pt-12 border-t border-slate-100 grid grid-cols-2 gap-8">
                  <div className="text-center">
                    <div className="h-px bg-slate-200 w-32 mx-auto mb-2"></div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Employee Signature</div>
                  </div>
                  <div className="text-center">
                    <div className="h-px bg-slate-200 w-32 mx-auto mb-2"></div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Authorized Signature</div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
