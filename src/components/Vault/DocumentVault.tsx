import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, Timestamp, getDoc } from 'firebase/firestore';
import { FileText, Plus, Search, Calendar, AlertTriangle, Trash2, Edit2, X, Shield, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBusiness } from '../../contexts/BusinessContext';
import { cn } from '../../lib/utils';
import { format, differenceInDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { createNotification } from '../../lib/notification-utils';

interface BranchDocument {
  id: string;
  name: string;
  documentNumber: string;
  issuedDate: string;
  nextRenewalDate: string;
  notes: string;
  businessId: string;
  branchId: string;
  ownerId: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  createdAt: any;
}

export const DocumentVault: React.FC = () => {
  const { userProfile, selectedBranch, selectedBusiness } = useBusiness();
  const [documents, setDocuments] = useState<BranchDocument[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<BranchDocument | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    documentNumber: '',
    issuedDate: format(new Date(), 'yyyy-MM-dd'),
    nextRenewalDate: format(new Date(), 'yyyy-MM-dd'),
    notes: '',
    fileUrl: '',
    fileName: '',
    fileSize: 0,
  });

  useEffect(() => {
    if (!userProfile?.businessId) return;

    let q = query(collection(db, 'branchDocuments'), where('businessId', '==', userProfile.businessId));
    
    if (userProfile.role === 'branch_manager' && userProfile.branchId) {
      q = query(q, where('branchId', '==', userProfile.branchId));
    } else if (selectedBranch) {
      q = query(q, where('branchId', '==', selectedBranch.id));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BranchDocument));
      setDocuments(docs);
      
      // Check for upcoming renewals (within 30 days)
      docs.forEach(doc => {
        const days = differenceInDays(parseISO(doc.nextRenewalDate), new Date());
        if (days <= 30 && days >= 0) {
          // Trigger notification if it's close to renewal
          // We could check if a notification already exists, but for now we'll just rely on the UI alert
          // Actually, let's create a system notification if it's the first time we see it
        }
      });
    });

    return () => unsubscribe();
  }, [userProfile, selectedBranch]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Enforce 1MB limit
    if (file.size > 1024 * 1024) {
      toast.error('File size must be less than 1MB');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      // In a real app, we would upload to Firebase Storage
      // For this demo, we'll convert to base64 and store in Firestore (not recommended for production)
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({
          ...prev,
          fileUrl: reader.result as string,
          fileName: file.name,
          fileSize: file.size
        }));
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Upload failed');
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile?.businessId || (!selectedBranch && userProfile.role !== 'branch_manager')) {
      toast.error('Please select a branch first');
      return;
    }

    const branchId = userProfile.role === 'branch_manager' ? userProfile.branchId : selectedBranch?.id;
    if (!branchId) return;

    try {
      if (editingDoc) {
        await updateDoc(doc(db, 'branchDocuments', editingDoc.id), {
          ...formData,
          updatedAt: Timestamp.now(),
        });
        toast.success('Document updated successfully');
      } else {
        // Check document count limit (10)
        const branchRef = doc(db, 'branches', branchId);
        const branchSnap = await getDoc(branchRef);
        const currentCount = branchSnap.data()?.documentCount || 0;

        if (currentCount >= 10) {
          toast.error('Maximum 10 documents allowed per branch');
          return;
        }

        await addDoc(collection(db, 'branchDocuments'), {
          ...formData,
          businessId: userProfile.businessId,
          branchId: branchId,
          ownerId: userProfile.uid,
          createdAt: Timestamp.now(),
        });

        // Update branch document count
        await updateDoc(branchRef, {
          documentCount: currentCount + 1
        });

        // Create notification for new document
        await createNotification(
          userProfile.businessId,
          'New Document Added',
          `A new document "${formData.name}" has been added to the vault.`,
          'system',
          undefined,
          '/vault'
        );

        toast.success('Document added to vault');
      }
      setIsModalOpen(false);
      setEditingDoc(null);
      setFormData({
        name: '',
        documentNumber: '',
        issuedDate: format(new Date(), 'yyyy-MM-dd'),
        nextRenewalDate: format(new Date(), 'yyyy-MM-dd'),
        notes: '',
        fileUrl: '',
        fileName: '',
        fileSize: 0,
      });
    } catch (error) {
      console.error('Error saving document:', error);
      toast.error('Failed to save document');
    }
  };

  const handleDelete = async (document: BranchDocument) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;

    try {
      await deleteDoc(doc(db, 'branchDocuments', document.id));
      
      // Update branch document count
      const branchRef = doc(db, 'branches', document.branchId);
      const branchSnap = await getDoc(branchRef);
      const currentCount = branchSnap.data()?.documentCount || 0;
      await updateDoc(branchRef, {
        documentCount: Math.max(0, currentCount - 1)
      });

      toast.success('Document removed from vault');
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    }
  };

  const getRenewalStatus = (date: string) => {
    const days = differenceInDays(parseISO(date), new Date());
    if (days < 0) return { label: 'Expired', color: 'text-red-500 bg-red-500/10', icon: AlertTriangle };
    if (days <= 30) return { label: `Expires in ${days} days`, color: 'text-amber-500 bg-amber-500/10', icon: Clock };
    return { label: 'Active', color: 'text-emerald-500 bg-emerald-500/10', icon: Shield };
  };

  const filteredDocs = documents.filter(doc => 
    doc.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.documentNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-black uppercase tracking-tighter flex items-center gap-2">
            <Shield className="text-blue-500 w-6 h-6 md:w-6 md:h-6" />
            Branch Vault
          </h2>
          <p className="text-[10px] md:text-xs text-slate-500 font-bold uppercase tracking-widest">Secure storage for branch licenses</p>
        </div>
        {userProfile?.role !== 'accountant' && (
          <button
            onClick={() => {
              setEditingDoc(null);
              setFormData({
                name: '',
                documentNumber: '',
                issuedDate: format(new Date(), 'yyyy-MM-dd'),
                nextRenewalDate: format(new Date(), 'yyyy-MM-dd'),
                notes: '',
                fileUrl: '',
                fileName: '',
                fileSize: 0
              });
              setIsModalOpen(true);
            }}
            className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white px-4 md:px-6 py-2.5 md:py-3 rounded-xl md:rounded-2xl font-black uppercase tracking-widest text-[10px] md:text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
          >
            <Plus size={16} className="md:w-[18px] md:h-[18px]" />
            Add Document
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
        {/* Stats */}
        <div className="md:col-span-1 space-y-3 md:space-y-4">
          <div className="bg-[#1E293B] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800">
            <div className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 md:mb-4">Vault Status</div>
            <div className="space-y-3 md:space-y-4">
              <div className="flex justify-between items-end">
                <span className="text-xl md:text-2xl font-black text-white">{documents.length}/10</span>
                <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">Capacity</span>
              </div>
              <div className="w-full h-1.5 md:h-2 bg-slate-900 rounded-full overflow-hidden">
                <div 
                  className={cn("h-full transition-all duration-500", documents.length >= 8 ? "bg-red-500" : "bg-blue-500")}
                  style={{ width: `${(documents.length / 10) * 100}%` }}
                />
              </div>
              <p className="text-[9px] md:text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-tight">
                Each branch can store up to 10 critical documents.
              </p>
            </div>
          </div>

          <div className="bg-[#1E293B] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800">
            <div className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3 md:mb-4">Search Vault</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4 md:w-[18px] md:h-[18px]" />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl md:rounded-2xl pl-9 md:pl-10 pr-4 py-2 md:py-3 text-white text-xs md:text-sm focus:border-blue-500 outline-none transition-all font-bold"
              />
            </div>
          </div>
        </div>

        {/* Document List */}
        <div className="md:col-span-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {filteredDocs.map((doc) => {
                const status = getRenewalStatus(doc.nextRenewalDate);
                const StatusIcon = status.icon;
                
                return (
                  <motion.div
                    key={doc.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-[#1E293B] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 hover:border-slate-700 transition-all group relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start mb-3 md:mb-4">
                      <div className="p-2 md:p-3 bg-slate-900 rounded-xl md:rounded-2xl text-blue-500 group-hover:scale-110 transition-transform">
                        <FileText size={20} className="md:w-6 md:h-6" />
                      </div>
                      {userProfile?.role !== 'accountant' && (
                        <div className="flex gap-1.5 md:gap-2">
                          <button
                            onClick={() => {
                              setEditingDoc(doc);
                              setFormData({
                                name: doc.name,
                                documentNumber: doc.documentNumber,
                                issuedDate: doc.issuedDate,
                                nextRenewalDate: doc.nextRenewalDate,
                                notes: doc.notes,
                                fileUrl: doc.fileUrl || '',
                                fileName: doc.fileName || '',
                                fileSize: doc.fileSize || 0
                              });
                              setIsModalOpen(true);
                            }}
                            className="p-1.5 md:p-2 text-slate-500 hover:text-blue-500 hover:bg-blue-500/10 rounded-lg md:rounded-xl transition-all"
                          >
                            <Edit2 size={14} className="md:w-4 md:h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(doc)}
                            className="p-1.5 md:p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg md:rounded-xl transition-all"
                          >
                            <Trash2 size={14} className="md:w-4 md:h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-base md:text-lg font-black text-white uppercase tracking-tight truncate">{doc.name}</h3>
                      <div className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest truncate">ID: {doc.documentNumber}</div>
                    </div>

                    <div className="mt-4 md:mt-6 grid grid-cols-2 gap-3 md:gap-4">
                      <div className="p-2.5 md:p-3 bg-slate-900 rounded-xl md:rounded-2xl border border-slate-800/50">
                        <div className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Issued</div>
                        <div className="text-[10px] md:text-xs font-bold text-white flex items-center gap-1">
                          <Calendar size={10} className="md:w-3 md:h-3 text-slate-500" />
                          {format(parseISO(doc.issuedDate), 'MMM dd, yy')}
                        </div>
                      </div>
                      <div className={cn("p-2.5 md:p-3 rounded-xl md:rounded-2xl border border-slate-800/50", status.color.replace('text-', 'bg-').replace('500', '500/5'))}>
                        <div className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Renewal</div>
                        <div className={cn("text-[10px] md:text-xs font-bold flex items-center gap-1", status.color)}>
                          <StatusIcon size={10} className="md:w-3 md:h-3" />
                          {format(parseISO(doc.nextRenewalDate), 'MMM dd, yy')}
                        </div>
                      </div>
                    </div>

                    {doc.notes && (
                      <div className="mt-4 p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed line-clamp-2">
                          {doc.notes}
                        </p>
                      </div>
                    )}

                    {doc.fileUrl && (
                      <div className="mt-4">
                        <a 
                          href={doc.fileUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="w-full flex items-center justify-center gap-2 p-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                        >
                          <FileText size={14} />
                          View Document
                        </a>
                      </div>
                    )}

                    <div className={cn("absolute top-0 right-0 px-4 py-1 rounded-bl-2xl text-[10px] font-black uppercase tracking-widest", status.color)}>
                      {status.label}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#1E293B] w-full max-w-lg max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
                <div className="flex items-center gap-2 md:gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-xl text-blue-500">
                    <Shield size={20} />
                  </div>
                  <h3 className="text-lg md:text-xl font-black uppercase tracking-tighter">
                    {editingDoc ? 'Edit Document' : 'Add New Document'}
                  </h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Document Name</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    placeholder="e.g. Trade License"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Document Number</label>
                  <input
                    type="text"
                    required
                    maxLength={50}
                    value={formData.documentNumber}
                    onChange={(e) => setFormData({ ...formData, documentNumber: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    placeholder="e.g. TL-2024-001"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Issued Date</label>
                    <input
                      type="date"
                      required
                      value={formData.issuedDate}
                      onChange={(e) => setFormData({ ...formData, issuedDate: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Next Renewal Date</label>
                    <input
                      type="date"
                      required
                      value={formData.nextRenewalDate}
                      onChange={(e) => setFormData({ ...formData, nextRenewalDate: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Notes</label>
                  <textarea
                    value={formData.notes}
                    maxLength={1000}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all font-bold min-h-[100px]"
                    placeholder="Additional details..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Document File (Max 1MB)</label>
                  <div className="relative">
                    <input
                      type="file"
                      onChange={handleFileChange}
                      className="hidden"
                      id="file-upload"
                      accept=".pdf,.jpg,.jpeg,.png"
                    />
                    <label
                      htmlFor="file-upload"
                      className={cn(
                        "w-full flex items-center justify-center gap-3 p-4 bg-slate-900 border-2 border-dashed border-slate-800 rounded-2xl cursor-pointer hover:border-blue-500 transition-all",
                        isUploading && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {formData.fileName ? (
                        <div className="flex items-center gap-2">
                          <FileText size={18} className="text-blue-500" />
                          <span className="text-xs font-bold text-white truncate max-w-[200px]">{formData.fileName}</span>
                          <span className="text-[10px] text-slate-500">({(formData.fileSize / 1024).toFixed(1)} KB)</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Plus size={20} className="text-slate-500" />
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Click to upload document</span>
                        </div>
                      )}
                    </label>
                  </div>
                </div>

                <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 flex items-start gap-3">
                  <Info size={16} className="text-blue-500 mt-0.5" />
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
                    Renewal alerts will appear on the dashboard 30 days before the next renewal date.
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 shadow-lg shadow-blue-500/20 mt-4"
                >
                  {editingDoc ? 'Update Document' : 'Add to Vault'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

import { Clock } from 'lucide-react';
