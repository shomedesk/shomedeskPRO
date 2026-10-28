import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { Plus, User, Briefcase, DollarSign, Calendar, Trash2, Edit2, X, Check, Phone, Mail, MapPin, Heart, ShieldAlert, FileText, Upload, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBusiness } from '../../contexts/BusinessContext';
import { cn } from '../../lib/utils';
import { Employee } from '../../types';

export const EmployeeManagement: React.FC = () => {
  const { userProfile, selectedBusiness, branches } = useBusiness();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    position: '',
    baseSalary: 0,
    joinDate: new Date().toISOString().split('T')[0],
    status: 'active' as 'active' | 'inactive',
    branchId: userProfile?.branchId || '',
    phone: '',
    email: '',
    address: '',
    bloodGroup: '',
    emergencyContact: '',
    nidPassport: '',
    documentUrl: '',
    documentName: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    bankBranch: '',
    ifscCode: '',
  });

  useEffect(() => {
    if (!userProfile?.businessId) return;

    let q = query(collection(db, 'employees'), where('businessId', '==', userProfile.businessId));
    
    if (userProfile.role === 'manager' && userProfile.branchId) {
      q = query(q, where('branchId', '==', userProfile.branchId));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(data);
    });

    return () => unsubscribe();
  }, [userProfile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024) {
      alert('File size must be less than 100KB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setFormData(prev => ({
        ...prev,
        documentUrl: event.target?.result as string,
        documentName: file.name
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile?.businessId) return;

    const employeeData = {
      ...formData,
      businessId: userProfile.businessId,
      branchId: userProfile.role === 'manager' ? userProfile.branchId : formData.branchId,
      createdAt: editingEmployee?.createdAt || serverTimestamp(),
    };

    try {
      if (editingEmployee) {
        await updateDoc(doc(db, 'employees', editingEmployee.id), employeeData as any);
      } else {
        await addDoc(collection(db, 'employees'), employeeData);
      }
      setIsModalOpen(false);
      setEditingEmployee(null);
      setFormData({
        name: '',
        position: '',
        baseSalary: 0,
        joinDate: new Date().toISOString().split('T')[0],
        status: 'active' as 'active' | 'inactive',
        branchId: userProfile?.branchId || '',
        phone: '',
        email: '',
        address: '',
        bloodGroup: '',
        emergencyContact: '',
        nidPassport: '',
        documentUrl: '',
        documentName: '',
        bankAccountName: '',
        bankAccountNumber: '',
        bankName: '',
        bankBranch: '',
        ifscCode: '',
      });
    } catch (error) {
      console.error('Error saving employee:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this employee?')) {
      try {
        await deleteDoc(doc(db, 'employees', id));
      } catch (error) {
        console.error('Error deleting employee:', error);
      }
    }
  };

  const openDocument = (url: string) => {
    const win = window.open();
    if (win) {
      win.document.write(`<iframe src="${url}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter">Employee Directory</h2>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Manage your workforce</p>
        </div>
        {(userProfile?.role === 'admin' || userProfile?.role === 'manager') && (
          <button
            onClick={() => {
              setEditingEmployee(null);
              setFormData({
                name: '',
                position: '',
                baseSalary: 0,
                joinDate: new Date().toISOString().split('T')[0],
                status: 'active' as 'active' | 'inactive',
                branchId: userProfile?.branchId || '',
                phone: '',
                email: '',
                address: '',
                bloodGroup: '',
                emergencyContact: '',
                nidPassport: '',
                documentUrl: '',
                documentName: '',
                bankAccountName: '',
                bankAccountNumber: '',
                bankName: '',
                bankBranch: '',
                ifscCode: '',
              });
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 shadow-lg shadow-blue-500/20"
          >
            <Plus size={18} />
            Add Employee
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {employees.map((employee) => (
            <motion.div
              key={employee.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl group hover:border-blue-500/50 transition-all"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
                  <User size={24} />
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {userProfile?.role !== 'accountant' && (
                    <>
                      <button
                        onClick={() => {
                          setEditingEmployee(employee);
                          setFormData({
                            name: employee.name,
                            position: employee.position,
                            baseSalary: employee.baseSalary,
                            joinDate: employee.joinDate,
                            status: employee.status,
                            branchId: employee.branchId,
                            phone: employee.phone || '',
                            email: employee.email || '',
                            address: employee.address || '',
                            bloodGroup: employee.bloodGroup || '',
                            emergencyContact: employee.emergencyContact || '',
                            nidPassport: employee.nidPassport || '',
                            documentUrl: employee.documentUrl || '',
                            documentName: employee.documentName || '',
                            bankAccountName: employee.bankAccountName || '',
                            bankAccountNumber: employee.bankAccountNumber || '',
                            bankName: employee.bankName || '',
                            bankBranch: employee.bankBranch || '',
                            ifscCode: employee.ifscCode || '',
                          });
                          setIsModalOpen(true);
                        }}
                        className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 transition-colors"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(employee.id)}
                        className="p-2 bg-red-500/10 hover:bg-red-500/20 rounded-xl text-red-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-black text-white uppercase tracking-tight">{employee.name}</h3>
                  <div className="flex items-center gap-2 text-slate-500">
                    <Briefcase size={14} />
                    <span className="text-xs font-bold uppercase tracking-widest">{employee.position}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {employee.phone && (
                    <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                      <Phone size={12} />
                      {employee.phone}
                    </div>
                  )}
                  {employee.email && (
                    <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                      <Mail size={12} />
                      {employee.email}
                    </div>
                  )}
                  {employee.bloodGroup && (
                    <div className="flex items-center gap-2 text-red-500 text-[10px] font-black uppercase tracking-widest">
                      <Heart size={12} />
                      Blood: {employee.bloodGroup}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800">
                  <div>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Base Salary</span>
                    <div className="flex items-center gap-1 text-emerald-500 font-black">
                      <span className="text-xs">{selectedBusiness?.currency || 'INR'}</span>
                      <span>{employee.baseSalary.toLocaleString()}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Status</span>
                    <span className={cn(
                      "text-[10px] font-black px-2 py-1 rounded-md uppercase",
                      employee.status === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                    )}>
                      {employee.status}
                    </span>
                  </div>
                </div>

                {employee.documentUrl && (
                  <button
                    onClick={() => openDocument(employee.documentUrl!)}
                    className="w-full mt-2 flex items-center justify-center gap-2 bg-slate-900 border border-slate-800 hover:border-blue-500/50 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-blue-500 transition-all"
                  >
                    <FileText size={14} />
                    View Documents
                  </button>
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
              className="bg-[#1E293B] w-full max-w-2xl max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
                <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter">
                  {editingEmployee ? 'Edit Employee' : 'Add New Employee'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 md:space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Basic Info */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-blue-500 uppercase tracking-[0.2em] mb-4">Basic Information</h4>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Full Name</label>
                      <input
                        required
                        type="text"
                        value={formData.name}
                        maxLength={100}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        placeholder="John Doe"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Position</label>
                      <input
                        required
                        type="text"
                        value={formData.position}
                        maxLength={100}
                        onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        placeholder="Branch Manager"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Base Salary</label>
                        <input
                          required
                          type="number"
                          value={formData.baseSalary}
                          min={0}
                          max={1000000000}
                          onChange={(e) => setFormData({ ...formData, baseSalary: Number(e.target.value) })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Join Date</label>
                        <input
                          required
                          type="date"
                          value={formData.joinDate}
                          onChange={(e) => setFormData({ ...formData, joinDate: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Branch</label>
                      <select
                        required
                        value={formData.branchId}
                        onChange={(e) => setFormData({ ...formData, branchId: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                      >
                        <option value="">Select Branch</option>
                        {branches.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Additional Info */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-black text-blue-500 uppercase tracking-[0.2em] mb-4">Additional Details</h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Phone</label>
                        <input
                          required
                          type="tel"
                          value={formData.phone}
                          maxLength={20}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Blood Group</label>
                        <select
                          value={formData.bloodGroup}
                          onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        >
                          <option value="">Select</option>
                          {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => (
                            <option key={bg} value={bg}>{bg}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Email</label>
                      <input
                        type="email"
                        value={formData.email}
                        maxLength={100}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">NID / Passport</label>
                      <input
                        type="text"
                        value={formData.nidPassport}
                        maxLength={50}
                        onChange={(e) => setFormData({ ...formData, nidPassport: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Emergency Contact</label>
                      <input
                        type="text"
                        value={formData.emergencyContact}
                        maxLength={100}
                        onChange={(e) => setFormData({ ...formData, emergencyContact: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        placeholder="Name & Number"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Address</label>
                  <textarea
                    value={formData.address}
                    maxLength={500}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold min-h-[80px]"
                  />
                </div>

                {/* Bank Account Details */}
                <div className="space-y-4 p-6 bg-slate-900/50 rounded-3xl border border-slate-800">
                  <h4 className="text-xs font-black text-emerald-500 uppercase tracking-[0.2em]">Employee Bank Details</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Account Name</label>
                      <input
                        type="text"
                        value={formData.bankAccountName}
                        maxLength={100}
                        onChange={(e) => setFormData({ ...formData, bankAccountName: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Account Number</label>
                      <input
                        type="text"
                        value={formData.bankAccountNumber}
                        maxLength={50}
                        onChange={(e) => setFormData({ ...formData, bankAccountNumber: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Bank Name</label>
                      <input
                        type="text"
                        value={formData.bankName}
                        maxLength={100}
                        onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">IFSC / Branch Code</label>
                      <input
                        type="text"
                        value={formData.ifscCode}
                        maxLength={20}
                        onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                      />
                    </div>
                  </div>
                </div>

                {/* File Upload */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Documents (PDF/Image - Max 100KB)</label>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 flex items-center justify-center gap-2 bg-slate-900 border border-dashed border-slate-700 hover:border-blue-500/50 py-4 rounded-2xl text-slate-500 hover:text-blue-500 transition-all"
                    >
                      <Upload size={20} />
                      <span className="text-xs font-black uppercase tracking-widest">
                        {formData.documentName || 'Upload Document'}
                      </span>
                    </button>
                    {formData.documentUrl && (
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, documentUrl: '', documentName: '' })}
                        className="p-4 bg-red-500/10 text-red-500 rounded-2xl hover:bg-red-500/20 transition-all"
                      >
                        <Trash2 size={20} />
                      </button>
                    )}
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".pdf,image/*"
                    className="hidden"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 shadow-lg shadow-blue-500/20 mt-4"
                >
                  {editingEmployee ? 'Update Employee' : 'Save Employee'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
