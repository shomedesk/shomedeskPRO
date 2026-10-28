import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, getDocs, limit } from 'firebase/firestore';
import { Calendar as CalendarIcon, CheckCircle2, XCircle, Clock, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBusiness } from '../../contexts/BusinessContext';
import { cn } from '../../lib/utils';

interface Employee {
  id: string;
  name: string;
  position: string;
  branchId: string;
}

interface AttendanceRecord {
  id?: string;
  employeeId: string;
  date: string;
  status: 'present' | 'absent' | 'late' | 'half-day';
  note?: string;
  businessId: string;
  branchId: string;
}

export const AttendanceTracker: React.FC = () => {
  const { userProfile } = useBusiness();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceRecord>>({});
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userProfile?.businessId) return;

    let q = query(collection(db, 'employees'), where('businessId', '==', userProfile.businessId), where('status', '==', 'active'));
    
    if (userProfile.role === 'manager' && userProfile.branchId) {
      q = query(q, where('branchId', '==', userProfile.branchId));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(data);
    });

    return () => unsubscribe();
  }, [userProfile]);

  useEffect(() => {
    if (!userProfile?.businessId || !selectedDate) return;

    const fetchAttendance = async () => {
      setIsLoading(true);
      const q = query(
        collection(db, 'attendance'),
        where('businessId', '==', userProfile.businessId),
        where('date', '==', selectedDate)
      );

      const snapshot = await getDocs(q);
      const records: Record<string, AttendanceRecord> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data() as AttendanceRecord;
        records[data.employeeId] = { id: doc.id, ...data };
      });
      setAttendance(records);
      setIsLoading(false);
    };

    fetchAttendance();
  }, [userProfile, selectedDate]);

  const handleStatusChange = async (employeeId: string, status: AttendanceRecord['status']) => {
    if (!userProfile?.businessId) return;

    const existingRecord = attendance[employeeId];
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    const recordData: Omit<AttendanceRecord, 'id'> = {
      employeeId,
      date: selectedDate,
      status,
      businessId: userProfile.businessId,
      branchId: employee.branchId,
    };

    try {
      if (existingRecord?.id) {
        await updateDoc(doc(db, 'attendance', existingRecord.id), { status });
      } else {
        const docRef = await addDoc(collection(db, 'attendance'), recordData);
        setAttendance(prev => ({
          ...prev,
          [employeeId]: { id: docRef.id, ...recordData }
        }));
      }
      
      // Optimistic update
      setAttendance(prev => ({
        ...prev,
        [employeeId]: { ...prev[employeeId], status }
      }));
    } catch (error) {
      console.error('Error saving attendance:', error);
    }
  };

  const changeDate = (days: number) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + days);
    setSelectedDate(date.toISOString().split('T')[0]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter">Daily Attendance</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Track employee presence</p>
        </div>

        <div className="flex items-center gap-4 bg-[#1E293B] p-2 rounded-2xl border border-slate-800">
          <button 
            onClick={() => changeDate(-1)}
            className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-all active:scale-95"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2 px-4">
            <CalendarIcon size={18} className="text-blue-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-sm font-black uppercase tracking-widest text-white outline-none"
            />
          </div>
          <button 
            onClick={() => changeDate(1)}
            className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-all active:scale-95"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <div className="bg-[#1E293B] rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 border-b border-slate-800">
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Position</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {employees.map((employee) => {
                const record = attendance[employee.id];
                return (
                  <tr key={employee.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500 font-black">
                          {employee.name.charAt(0)}
                        </div>
                        <span className="font-bold text-white">{employee.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{employee.position}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-center gap-2">
                        {[
                          { id: 'present', icon: CheckCircle2, color: 'emerald', label: 'Present' },
                          { id: 'absent', icon: XCircle, color: 'red', label: 'Absent' },
                          { id: 'late', icon: Clock, color: 'amber', label: 'Late' },
                          { id: 'half-day', icon: AlertCircle, color: 'blue', label: 'Half Day' },
                        ].map((status) => (
                          <button
                            key={status.id}
                            onClick={() => userProfile?.role !== 'accountant' && handleStatusChange(employee.id, status.id as any)}
                            disabled={userProfile?.role === 'accountant'}
                            className={cn(
                              "flex flex-col items-center gap-1 p-2 rounded-xl border transition-all active:scale-95",
                              record?.status === status.id
                                ? `bg-${status.color}-500/10 border-${status.color}-500/50 text-${status.color}-500`
                                : "bg-slate-900 border-slate-800 text-slate-600 hover:border-slate-700",
                              userProfile?.role === 'accountant' && "cursor-not-allowed opacity-50"
                            )}
                            title={status.label}
                          >
                            <status.icon size={20} />
                            <span className="text-[8px] font-black uppercase tracking-tighter">{status.label}</span>
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
