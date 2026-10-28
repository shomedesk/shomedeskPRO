import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { Plus, Calendar, Clock, CheckCircle, XCircle, AlertCircle, User, MessageSquare, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBusiness } from '../../contexts/BusinessContext';
import { cn } from '../../lib/utils';
import { createNotification } from '../../lib/notification-utils';

interface Employee {
  id: string;
  name: string;
  branchId: string;
}

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName?: string;
  startDate: string;
  endDate: string;
  type: 'sick' | 'casual' | 'unpaid' | 'other';
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  businessId: string;
  branchId: string;
  createdAt: any;
}

export const LeaveManagement: React.FC = () => {
  const { userProfile } = useBusiness();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    employeeId: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    type: 'casual' as const,
    reason: '',
  });

  useEffect(() => {
    if (!userProfile?.businessId) return;

    // Fetch employees for the dropdown
    let empQ = query(collection(db, 'employees'), where('businessId', '==', userProfile.businessId), where('status', '==', 'active'));
    if (userProfile.role === 'manager' && userProfile.branchId) {
      empQ = query(empQ, where('branchId', '==', userProfile.branchId));
    }

    const unsubEmployees = onSnapshot(empQ, (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
    });

    // Fetch leave requests
    let leaveQ = query(collection(db, 'leaveRequests'), where('businessId', '==', userProfile.businessId));
    if (userProfile.role === 'manager' && userProfile.branchId) {
      leaveQ = query(leaveQ, where('branchId', '==', userProfile.branchId));
    }

    const unsubLeaves = onSnapshot(leaveQ, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequest));
      setLeaveRequests(data.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds));
    });

    return () => {
      unsubEmployees();
      unsubLeaves();
    };
  }, [userProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile?.businessId || !formData.employeeId) return;

    const selectedEmployee = employees.find(emp => emp.id === formData.employeeId);
    
    const requestData = {
      ...formData,
      employeeName: selectedEmployee?.name,
      businessId: userProfile.businessId,
      branchId: selectedEmployee?.branchId || userProfile.branchId,
      status: 'pending',
      createdAt: Timestamp.now(),
    };

    try {
      await addDoc(collection(db, 'leaveRequests'), requestData);
      
      // Create notification for admin/manager
      await createNotification(
        userProfile.businessId,
        'New Leave Request',
        `${selectedEmployee?.name} requested ${formData.type} leave from ${formData.startDate} to ${formData.endDate}`,
        'leave_request',
        undefined,
        '/payroll'
      );

      setIsModalOpen(false);
      setFormData({
        employeeId: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        type: 'casual',
        reason: '',
      });
    } catch (error) {
      console.error('Error submitting leave request:', error);
    }
  };

  const handleStatusUpdate = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await updateDoc(doc(db, 'leaveRequests', id), { 
        status,
        approvedBy: userProfile?.uid 
      });
    } catch (error) {
      console.error('Error updating leave status:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'text-emerald-500 bg-emerald-500/10';
      case 'rejected': return 'text-red-500 bg-red-500/10';
      default: return 'text-amber-500 bg-amber-500/10';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter">Leave Portal</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Manage employee time off</p>
        </div>
        {userProfile?.role !== 'accountant' && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 shadow-lg shadow-blue-500/20"
          >
            <Plus size={18} />
            New Request
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4">
        <AnimatePresence mode="popLayout">
          {leaveRequests.map((request) => (
            <motion.div
              key={request.id}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-900 rounded-2xl text-blue-500">
                  <User size={24} />
                </div>
                <div>
                  <h3 className="font-black text-white uppercase tracking-tight">{request.employeeName || 'Unknown Employee'}</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className={cn("text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-widest", getStatusColor(request.status))}>
                      {request.status}
                    </span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-slate-900 px-2 py-0.5 rounded">
                      {request.type}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-slate-500" />
                  <div className="text-xs font-bold text-slate-300">
                    {request.startDate} <span className="text-slate-600 mx-1">→</span> {request.endDate}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 max-w-xs">
                  <MessageSquare size={16} className="text-slate-500" />
                  <p className="text-xs text-slate-400 italic truncate">{request.reason}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {request.status === 'pending' && (userProfile?.role === 'admin' || userProfile?.role === 'manager') && (
                  <>
                    <button
                      onClick={() => handleStatusUpdate(request.id, 'approved')}
                      className="p-3 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-2xl transition-all active:scale-95"
                      title="Approve"
                    >
                      <CheckCircle size={20} />
                    </button>
                    <button
                      onClick={() => handleStatusUpdate(request.id, 'rejected')}
                      className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl transition-all active:scale-95"
                      title="Reject"
                    >
                      <XCircle size={20} />
                    </button>
                  </>
                )}
                {request.status !== 'pending' && (
                  <div className={cn("p-3 rounded-2xl", getStatusColor(request.status))}>
                    {request.status === 'approved' ? <CheckCircle size={20} /> : <XCircle size={20} />}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
                <h3 className="text-xl font-black uppercase tracking-tighter">Request Leave</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Select Employee</label>
                  <select
                    required
                    value={formData.employeeId}
                    onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                  >
                    <option value="">Choose an employee...</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Start Date</label>
                    <input
                      required
                      type="date"
                      value={formData.startDate}
                      onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">End Date</label>
                    <input
                      required
                      type="date"
                      value={formData.endDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Leave Type</label>
                  <select
                    required
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                  >
                    <option value="casual">Casual Leave</option>
                    <option value="sick">Sick Leave</option>
                    <option value="unpaid">Unpaid Leave</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Reason</label>
                  <textarea
                    required
                    value={formData.reason}
                    maxLength={500}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold min-h-[100px]"
                    placeholder="Briefly explain the reason..."
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 shadow-lg shadow-blue-500/20 mt-4"
                >
                  Submit Request
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
