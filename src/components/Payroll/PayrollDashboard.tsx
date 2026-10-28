import React, { useState } from 'react';
import { EmployeeManagement } from './EmployeeManagement';
import { AttendanceTracker } from './AttendanceTracker';
import { LeaveManagement } from './LeaveManagement';
import { SalaryManagement } from './SalaryManagement';
import { Users, Calendar, Clock, DollarSign, LayoutDashboard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';

type Tab = 'overview' | 'employees' | 'attendance' | 'leave' | 'salary';

export const PayrollDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'employees', label: 'Employees', icon: Users },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'leave', label: 'Leave Portal', icon: Calendar },
    { id: 'salary', label: 'Salary', icon: DollarSign },
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 md:gap-6">
        <div>
          <h1 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-white">Payroll</h1>
          <p className="text-[10px] md:text-xs text-slate-500 font-bold uppercase tracking-widest mt-1 md:mt-2">Complete workforce & salary control system</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1.5 md:gap-2 p-1.5 md:p-2 bg-[#1E293B] rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as Tab)}
            className={cn(
              "flex items-center gap-2 md:gap-3 px-4 md:px-6 py-2 md:py-3 rounded-xl md:rounded-2xl font-black uppercase tracking-widest text-[9px] md:text-[10px] transition-all active:scale-95 whitespace-nowrap",
              activeTab === tab.id
                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                : "text-slate-500 hover:text-white hover:bg-slate-800"
            )}
          >
            <tab.icon size={14} className="md:w-4 md:h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[600px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                <div className="bg-[#1E293B] p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl">
                  <div className="p-2.5 md:p-3 bg-blue-500/10 rounded-xl md:rounded-2xl text-blue-500 w-fit mb-3 md:mb-4">
                    <Users size={20} className="md:w-6 md:h-6" />
                  </div>
                  <h3 className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Total Employees</h3>
                  <div className="text-2xl md:text-3xl font-black text-white">Manage All</div>
                  <button onClick={() => setActiveTab('employees')} className="mt-3 md:mt-4 text-[9px] md:text-[10px] font-black text-blue-500 uppercase tracking-widest hover:underline">View Directory →</button>
                </div>
                <div className="bg-[#1E293B] p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl">
                  <div className="p-2.5 md:p-3 bg-emerald-500/10 rounded-xl md:rounded-2xl text-emerald-500 w-fit mb-3 md:mb-4">
                    <Clock size={20} className="md:w-6 md:h-6" />
                  </div>
                  <h3 className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Attendance</h3>
                  <div className="text-2xl md:text-3xl font-black text-white">Daily Track</div>
                  <button onClick={() => setActiveTab('attendance')} className="mt-3 md:mt-4 text-[9px] md:text-[10px] font-black text-emerald-500 uppercase tracking-widest hover:underline">Mark Today →</button>
                </div>
                <div className="bg-[#1E293B] p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl">
                  <div className="p-2.5 md:p-3 bg-amber-500/10 rounded-xl md:rounded-2xl text-amber-500 w-fit mb-3 md:mb-4">
                    <Calendar size={20} className="md:w-6 md:h-6" />
                  </div>
                  <h3 className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Leave Requests</h3>
                  <div className="text-2xl md:text-3xl font-black text-white">Pending Review</div>
                  <button onClick={() => setActiveTab('leave')} className="mt-3 md:mt-4 text-[9px] md:text-[10px] font-black text-amber-500 uppercase tracking-widest hover:underline">Review Now →</button>
                </div>
                <div className="bg-[#1E293B] p-6 md:p-8 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl">
                  <div className="p-2.5 md:p-3 bg-red-500/10 rounded-xl md:rounded-2xl text-red-500 w-fit mb-3 md:mb-4">
                    <DollarSign size={20} className="md:w-6 md:h-6" />
                  </div>
                  <h3 className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Salary Status</h3>
                  <div className="text-2xl md:text-3xl font-black text-white">Monthly Payroll</div>
                  <button onClick={() => setActiveTab('salary')} className="mt-3 md:mt-4 text-[9px] md:text-[10px] font-black text-red-500 uppercase tracking-widest hover:underline">Process Salary →</button>
                </div>
              </div>
            )}
            {activeTab === 'employees' && <EmployeeManagement />}
            {activeTab === 'attendance' && <AttendanceTracker />}
            {activeTab === 'leave' && <LeaveManagement />}
            {activeTab === 'salary' && <SalaryManagement />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};
