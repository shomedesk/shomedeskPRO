import React, { useState } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs, setDoc, arrayUnion } from 'firebase/firestore';
import { Business, Branch, BankAccount, UserProfile, Service, ServiceType } from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import { 
  Building2, 
  Plus, 
  Edit2, 
  Trash2, 
  Save, 
  X, 
  MapPin, 
  Briefcase,
  User,
  CreditCard,
  Phone,
  Key,
  DollarSign,
  Globe,
  Users,
  Mail,
  Shield,
  RefreshCw,
  Settings as SettingsIcon
} from 'lucide-react';
import { currencyService } from '@/src/services/currencyService';
import { getDoc } from 'firebase/firestore';
import { cn } from '@/src/lib/utils';
import { query, where, onSnapshot } from 'firebase/firestore';
import { useEffect } from 'react';

export default function Settings() {
  const { businesses, branches, services, bankAccounts, selectedBusiness, setSelectedBusiness, userProfile, loading: businessLoading } = useBusiness();
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isBusinessModalOpen, setIsBusinessModalOpen] = useState(false);
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [editingTeamMember, setEditingTeamMember] = useState<UserProfile | null>(null);
  const [teamMembers, setTeamMembers] = useState<UserProfile[]>([]);
  const [isCurrencySettingsOpen, setIsCurrencySettingsOpen] = useState(false);
  const [isTickerSettingsOpen, setIsTickerSettingsOpen] = useState(false);
  const [newCurrencyCode, setNewCurrencyCode] = useState('');
  const [tickerSettings, setTickerSettings] = useState({
    enabled: true,
    pairs: [
      { from: 'USD', to: 'OMR' },
      { from: 'USD', to: 'INR' },
      { from: 'USD', to: 'SAR' },
      { from: 'USD', to: 'AED' },
      { from: 'USD', to: 'BDT' }
    ],
    speed: 30
  });
  const [currencySettings, setCurrencySettings] = useState({
    useManualRates: false,
    rates: {
      'USD': 1,
      'INR': 83.5,
      'BDT': 110.0,
      'EUR': 0.92,
      'GBP': 0.79,
      'AED': 3.67,
      'SAR': 3.75,
      'OMR': 0.38,
      'QAR': 3.64,
      'KWD': 0.31,
      'BHD': 0.38
    }
  });

  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  useEffect(() => {
    if (!businessLoading && businesses.length === 0 && !hasAutoOpened && (!userProfile || userProfile.role === 'admin')) {
      setIsBusinessModalOpen(true);
      setHasAutoOpened(true);
    }
  }, [businessLoading, businesses.length, hasAutoOpened, userProfile]);

  useEffect(() => {
    if (!selectedBusiness) return;

    const q = query(
      collection(db, 'users'),
      where('businessId', '==', selectedBusiness.id),
      where('role', 'in', ['admin', 'manager', 'accountant'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const members = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      setTeamMembers(members);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'users');
    });

    return () => unsubscribe();
  }, [selectedBusiness]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const docRef = doc(db, 'systemSettings', 'currency');
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setCurrencySettings(docSnap.data() as any);
      }
    }, (error) => {
      console.warn('Notice loading currency settings:', error.message);
    });
    return () => unsub();
  }, [auth.currentUser]);

  useEffect(() => {
    if (!auth.currentUser) return;
    const docRef = doc(db, 'systemSettings', 'ticker');
    const unsub = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setTickerSettings(docSnap.data() as any);
      }
    }, (error) => {
      console.warn('Notice loading ticker settings:', error.message);
    });
    return () => unsub();
  }, [auth.currentUser]);

  const handleSaveCurrencySettings = async () => {
    try {
      await currencyService.saveManualRates(currencySettings.rates, currencySettings.useManualRates);
      toast.success('Currency settings saved');
      setIsCurrencySettingsOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'systemSettings/currency');
      toast.error('Failed to save currency settings');
    }
  };

  const handleSaveTickerSettings = async () => {
    try {
      await setDoc(doc(db, 'systemSettings', 'ticker'), tickerSettings);
      toast.success('Ticker settings saved');
      setIsTickerSettingsOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'systemSettings/ticker');
      toast.error('Failed to save ticker settings');
    }
  };

  const handleSaveTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBusiness) return;
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const displayName = (form.elements.namedItem('displayName') as HTMLInputElement).value;
    const role = (form.elements.namedItem('role') as HTMLSelectElement).value;

    try {
      // For simplicity, we create a placeholder user doc. 
      // In a real app, you'd use Firebase Admin or an invitation system.
      // Here, we just set the doc so when they log in via Google, they get this role.
      
      // We need a unique ID if it's a new member. Since we don't have their UID yet,
      // we'll use their email as a temporary key or just search by email in Auth.tsx.
      // Better: search by email in Auth.tsx.
      
      // For now, let's just add to a 'team_invitations' or similar, 
      // but the user said "admin and manager er kache complete access thakbe".
      // I'll just use the 'users' collection and Auth.tsx will check it.
      
      const q = query(collection(db, 'users'), where('email', '==', email));
      let snap;
      try {
        snap = await getDocs(q);
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'users');
        throw error;
      }
      
      if (!snap.empty) {
        const userDoc = snap.docs[0];
        await updateDoc(doc(db, 'users', userDoc.id), {
          role,
          businessId: selectedBusiness.id
        });
      } else {
        // Create a placeholder doc with email as ID (or a random ID)
        // Auth.tsx should be updated to check for email if UID doesn't exist.
        await addDoc(collection(db, 'users'), {
          email,
          displayName,
          role,
          businessId: selectedBusiness.id,
          isPlaceholder: true
        });
      }
      
      toast.success('Team member updated');
      setIsTeamModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
      toast.error('Failed to save team member');
    }
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const businessId = (form.elements.namedItem('businessId') as HTMLSelectElement).value;
    if (!businessId) return;
    
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const type = (form.elements.namedItem('type') as HTMLSelectElement).value as ServiceType;
    const description = (form.elements.namedItem('description') as HTMLInputElement).value;

    try {
      if (editingService) {
        await updateDoc(doc(db, 'services', editingService.id), { 
          businessId,
          name, 
          type,
          description
        });
        toast.success('Service updated');
      } else {
        await addDoc(collection(db, 'services'), {
          businessId,
          ownerId: auth.currentUser?.uid,
          name,
          type,
          description,
          createdAt: serverTimestamp()
        });
        toast.success('Service added');
      }
      setIsServiceModalOpen(false);
      setEditingService(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'services');
      toast.error('Failed to save service');
    }
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const businessId = (form.elements.namedItem('businessId') as HTMLSelectElement).value;
    if (!businessId) return;

    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const branchCode = (form.elements.namedItem('branchCode') as HTMLInputElement).value;
    const location = (form.elements.namedItem('location') as HTMLInputElement).value;
    const managerName = (form.elements.namedItem('managerName') as HTMLInputElement).value;
    const managerId = (form.elements.namedItem('managerId') as HTMLInputElement).value;
    const managerPin = (form.elements.namedItem('managerPin') as HTMLInputElement).value;
    const mobileNumber = (form.elements.namedItem('mobileNumber') as HTMLInputElement).value;
    const branchCurrency = ((form.elements.namedItem('currency') as HTMLSelectElement)?.value || 'OMR').trim();

    try {
      if (editingBranch) {
        await updateDoc(doc(db, 'branches', editingBranch.id), { 
          businessId,
          name, 
          branchCode,
          location, 
          managerName, 
          managerId,
          managerPin, 
          mobileNumber,
          currency: branchCurrency,
        });
        toast.success('Branch updated');
      } else {
        await addDoc(collection(db, 'branches'), {
          businessId,
          ownerId: auth.currentUser?.uid,
          name,
          branchCode,
          location,
          managerName,
          managerId,
          managerPin,
          mobileNumber,
          currency: branchCurrency,
          createdAt: serverTimestamp()
        });
        toast.success('Branch added');
      }
      setIsBranchModalOpen(false);
      setEditingBranch(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'branches');
      toast.error('Failed to save branch');
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const currency = (form.elements.namedItem('currency') as HTMLInputElement).value;
    const mobileNumber = (form.elements.namedItem('mobileNumber') as HTMLInputElement).value;

    try {
      if (editingBusiness) {
        await updateDoc(doc(db, 'businesses', editingBusiness.id), { 
          name, 
          currency, 
          mobileNumber 
        });
        toast.success('Business profile updated');
      } else {
        const docRef = await addDoc(collection(db, 'businesses'), {
          ownerId: auth.currentUser?.uid,
          name,
          currency,
          mobileNumber,
          createdAt: serverTimestamp()
        });
        
        // Ensure user profile exists and is linked to this business
        if (auth.currentUser) {
          await setDoc(doc(db, 'users', auth.currentUser.uid), {
            uid: auth.currentUser.uid,
            email: auth.currentUser.email,
            displayName: auth.currentUser.displayName,
            role: 'admin',
            businessId: docRef.id,
            ownedBusinessIds: arrayUnion(docRef.id)
          }, { merge: true });
        }
        
        const newBusiness = {
          id: docRef.id,
          ownerId: auth.currentUser?.uid,
          name,
          currency,
          mobileNumber,
        } as Business;
        
        await setSelectedBusiness(newBusiness);

        // Create a default branch for the new business
        await addDoc(collection(db, 'branches'), {
          businessId: docRef.id,
          ownerId: auth.currentUser?.uid,
          name: 'Main Branch',
          branchCode: 'MAIN',
          location: 'Default Location',
          managerName: 'Admin',
          managerId: 'admin',
          managerPin: '123456',
          mobileNumber: mobileNumber,
          createdAt: serverTimestamp()
        });
        toast.success('New business created');
      }
      setIsBusinessModalOpen(false);
      setEditingBusiness(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'businesses/users/branches');
      toast.error('Failed to save business');
    }
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const businessId = (form.elements.namedItem('businessId') as HTMLSelectElement).value;
    if (!businessId) return;

    const accountName = (form.elements.namedItem('accountName') as HTMLInputElement).value;
    const accountNumber = (form.elements.namedItem('accountNumber') as HTMLInputElement).value;
    const bankName = (form.elements.namedItem('bankName') as HTMLInputElement).value;
    const branchId = (form.elements.namedItem('branchId') as HTMLSelectElement).value;
    const serviceId = (form.elements.namedItem('serviceId') as HTMLSelectElement).value;

    try {
      if (editingBank) {
        await updateDoc(doc(db, 'bankAccounts', editingBank.id), { 
          businessId,
          accountName, 
          accountNumber, 
          bankName,
          branchId,
          serviceId
        });
        toast.success('Bank account updated');
      } else {
        await addDoc(collection(db, 'bankAccounts'), {
          businessId,
          branchId,
          serviceId,
          ownerId: auth.currentUser?.uid,
          accountName,
          accountNumber,
          bankName,
          balance: 0,
          createdAt: serverTimestamp()
        });
        toast.success('Bank account added');
      }
      setIsBankModalOpen(false);
      setEditingBank(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bankAccounts');
      toast.error('Failed to save bank account');
    }
  };

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const handleDeleteBranch = (id: string) => {
    setConfirmAction({
      title: 'Delete Branch',
      message: 'Are you sure you want to delete this branch? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'branches', id));
          toast.success('Branch deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `branches/${id}`);
          toast.error('Failed to delete branch');
        }
      }
    });
    setIsConfirmModalOpen(true);
  };

  const handleDeleteBank = (id: string) => {
    setConfirmAction({
      title: 'Delete Bank Account',
      message: 'Are you sure you want to delete this bank account? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'bankAccounts', id));
          toast.success('Bank account deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `bankAccounts/${id}`);
          toast.error('Failed to delete bank account');
        }
      }
    });
    setIsConfirmModalOpen(true);
  };

  const handleDeleteService = (id: string) => {
    setConfirmAction({
      title: 'Delete Service',
      message: 'Are you sure you want to delete this service? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'services', id));
          toast.success('Service deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `services/${id}`);
          toast.error('Failed to delete service');
        }
      }
    });
    setIsConfirmModalOpen(true);
  };


  return (
    <div className="space-y-8 md:space-y-12 pb-20">
      {/* Business Profile */}
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div className="space-y-1">
            <h2 className="text-xl md:text-2xl font-black tracking-tight flex items-center gap-2 md:gap-3">
              <Briefcase className="text-indigo-500 w-6 h-6 md:w-7 md:h-7" />
              Business Profile
            </h2>
            <p className="text-slate-400 font-bold text-[10px] md:text-sm uppercase tracking-widest">Manage your global business settings</p>
          </div>
          <div className="flex flex-wrap gap-2 md:gap-3 w-full md:w-auto">
            {userProfile?.role === 'admin' && (
              <button
                onClick={() => { setEditingBusiness(null); setIsBusinessModalOpen(true); }}
                className="flex-1 md:flex-none bg-indigo-600 hover:bg-indigo-500 text-white font-black py-2.5 md:py-3 px-4 md:px-6 rounded-xl md:rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-indigo-900/20 text-[10px] md:text-xs"
              >
                <Plus size={16} className="md:w-[18px] md:h-[18px]" />
                Add New
              </button>
            )}
            {userProfile?.role === 'admin' && (
              <button
                onClick={() => { setEditingBusiness(selectedBusiness); setIsBusinessModalOpen(true); }}
                className="flex-1 md:flex-none bg-slate-800 hover:bg-slate-700 text-white font-black py-2.5 md:py-3 px-4 md:px-6 rounded-xl md:rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-slate-700 text-[10px] md:text-xs"
              >
                <Edit2 size={16} className="md:w-[18px] md:h-[18px]" />
                Edit Selected
              </button>
            )}
          </div>
        </div>

        <div className="bg-[#1E293B] p-4 md:p-8 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl space-y-6 md:space-y-8">
          {!selectedBusiness ? (
            <div className="p-8 md:p-12 text-center space-y-4">
              <div className="bg-slate-900 w-12 h-12 md:w-16 md:h-16 rounded-full flex items-center justify-center mx-auto text-indigo-500">
                <Briefcase size={24} className="md:w-8 md:h-8" />
              </div>
              <div className="space-y-1">
                <p className="text-slate-200 font-black text-base md:text-lg">No Business Selected</p>
                <p className="text-slate-500 text-[10px] md:text-sm font-bold">Create or select a business to manage its settings</p>
              </div>
              <button
                onClick={() => { setEditingBusiness(null); setIsBusinessModalOpen(true); }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-black py-2.5 md:py-3 px-6 md:px-8 rounded-xl md:rounded-2xl transition-all active:scale-95 shadow-lg shadow-indigo-900/20 text-xs"
              >
                Create Your First Business
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
              <div className="space-y-1.5 md:space-y-2">
                <label className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Business Name</label>
                <div className="bg-slate-900 border border-slate-800 rounded-xl md:rounded-2xl p-3 md:p-4 text-sm md:text-lg font-black text-slate-200 flex items-center gap-2 md:gap-3">
                  <Building2 size={18} className="md:w-5 md:h-5 text-blue-400" />
                  <span className="truncate">{selectedBusiness.name}</span>
                </div>
              </div>
              <div className="space-y-1.5 md:space-y-2">
                <label className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Currency</label>
                <div className="bg-slate-900 border border-slate-800 rounded-xl md:rounded-2xl p-3 md:p-4 text-sm md:text-lg font-black text-slate-200 flex items-center gap-2 md:gap-3">
                  <DollarSign size={18} className="md:w-5 md:h-5 text-green-400" />
                  {selectedBusiness.currency || 'USD'}
                </div>
              </div>
              <div className="space-y-1.5 md:space-y-2">
                <label className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Mobile Number</label>
                <div className="bg-slate-900 border border-slate-800 rounded-xl md:rounded-2xl p-3 md:p-4 text-sm md:text-lg font-black text-slate-200 flex items-center gap-2 md:gap-3">
                  <Phone size={18} className="md:w-5 md:h-5 text-purple-400" />
                  {selectedBusiness.mobileNumber || 'Not Set'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bank Accounts */}
      <div className="space-y-6">
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
              <CreditCard className="text-emerald-500" size={28} />
              Bank Accounts
            </h2>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Manage your business bank accounts</p>
          </div>
          {userProfile?.role !== 'accountant' && (
            <button
              onClick={() => { setEditingBank(null); setIsBankModalOpen(true); }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-3 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
            >
              <Plus size={20} />
              Add Bank
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bankAccounts.map((bank) => (
            <div key={bank.id} className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl flex justify-between items-center group">
              <div className="flex items-center gap-4">
                <div className="bg-slate-900 p-3 rounded-2xl text-emerald-400">
                  <CreditCard size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-200">{bank.accountName}</h3>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{bank.bankName} • {bank.accountNumber}</p>
                  <p className="text-sm font-black text-emerald-400 mt-1">{selectedBusiness?.currency || '$'} {bank.balance.toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {userProfile?.role !== 'accountant' && (
                  <button 
                    onClick={() => { setEditingBank(bank); setIsBankModalOpen(true); }}
                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all"
                  >
                    <Edit2 size={18} />
                  </button>
                )}
                {userProfile?.role !== 'accountant' && (
                  <button 
                    onClick={() => handleDeleteBank(bank.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Branches */}
      <div className="space-y-6">
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
              <Building2 className="text-blue-500" size={28} />
              Manage Branches
            </h2>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Add or edit your business locations and managers</p>
          </div>
          {userProfile?.role !== 'accountant' && (
            <button
              onClick={() => { setEditingBranch(null); setIsBranchModalOpen(true); }}
              className="bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
            >
              <Plus size={20} />
              Add Branch
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {branches.map((br) => (
            <div key={br.id} className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl flex justify-between items-center group">
              <div className="flex items-center gap-4">
                <div className="bg-slate-900 p-3 rounded-2xl text-blue-400">
                  <MapPin size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-slate-200">{br.name}</h3>
                    <span className="text-[10px] font-black bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-md uppercase border border-blue-500/20">
                      ID: {br.branchCode}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{br.location}</p>
                  <div className="flex gap-4 mt-2">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                      <User size={12} className="text-blue-500" />
                      {br.managerName}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                      <Phone size={12} className="text-blue-500" />
                      {br.mobileNumber}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {userProfile?.role !== 'accountant' && (
                  <button 
                    onClick={() => { setEditingBranch(br); setIsBranchModalOpen(true); }}
                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all"
                  >
                    <Edit2 size={18} />
                  </button>
                )}
                {userProfile?.role !== 'accountant' && (
                  <button 
                    onClick={() => handleDeleteBranch(br.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Digital Services */}
      <div className="space-y-6">
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
              <Globe className="text-indigo-500" size={28} />
              Digital Services
            </h2>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Manage your online apps, subscriptions, and digital revenue</p>
          </div>
          {userProfile?.role !== 'accountant' && (
            <button
              onClick={() => { setEditingService(null); setIsServiceModalOpen(true); }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black py-3 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
            >
              <Plus size={20} />
              Add Service
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {services.map((service) => (
            <div key={service.id} className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl flex justify-between items-center group">
              <div className="flex items-center gap-4">
                <div className="bg-slate-900 p-3 rounded-2xl text-indigo-400">
                  <Globe size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black text-slate-200">{service.name}</h3>
                    <span className="text-[10px] font-black bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-md uppercase border border-indigo-500/20">
                      {service.type.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{service.description || 'No description'}</p>
                </div>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {userProfile?.role !== 'accountant' && (
                  <button 
                    onClick={() => { setEditingService(service); setIsServiceModalOpen(true); }}
                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-xl transition-all"
                  >
                    <Edit2 size={18} />
                  </button>
                )}
                {userProfile?.role !== 'accountant' && (
                  <button 
                    onClick={() => handleDeleteService(service.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Currency Management */}
      <div className="space-y-6">
        <div className="bg-[#1E293B] p-8 rounded-3xl border border-slate-800 shadow-xl">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500/10 rounded-2xl text-blue-500">
                <Globe size={24} />
              </div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-widest">Currency Management</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Manage exchange rates and conversion modes</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsTickerSettingsOpen(true)}
                className="p-3 bg-slate-900 hover:bg-slate-800 rounded-2xl transition-all border border-slate-800 text-blue-400 active:scale-95 flex items-center gap-2"
                title="Ticker Settings"
              >
                <RefreshCw size={20} className={tickerSettings.enabled ? "animate-spin-slow" : ""} />
                <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block">Ticker</span>
              </button>
              <button
                onClick={() => setIsCurrencySettingsOpen(true)}
                className="p-3 bg-slate-900 hover:bg-slate-800 rounded-2xl transition-all border border-slate-800 text-slate-400 active:scale-95"
              >
                <SettingsIcon size={20} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 bg-slate-900/50 rounded-2xl border border-slate-800 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Conversion Mode</span>
                <span className={cn(
                  "text-xs font-black px-2 py-1 rounded-md uppercase",
                  currencySettings.useManualRates ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
                )}>
                  {currencySettings.useManualRates ? 'Manual Override' : 'Real-time API'}
                </span>
              </div>
              <RefreshCw size={20} className={cn("text-slate-700", !currencySettings.useManualRates && "animate-spin-slow text-emerald-500")} />
            </div>
            <div className="p-5 bg-slate-900/50 rounded-2xl border border-slate-800 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Reference Currency</span>
                <span className="text-sm font-black text-white">USD (Global Standard)</span>
                <p className="text-[9px] text-slate-600 font-bold uppercase mt-1">All manual rates are relative to 1 USD</p>
              </div>
              <Globe size={20} className="text-slate-700" />
            </div>
          </div>
        </div>
      </div>

      {/* Team Management */}
      {userProfile?.role === 'admin' && (
        <div className="space-y-6">
          <div className="flex justify-between items-end">
            <div className="space-y-1">
              <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
                <Users className="text-indigo-500" size={28} />
                Team Management
              </h2>
              <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">Manage Admins and Accounts Managers</p>
            </div>
            <button
              onClick={() => { setEditingTeamMember(null); setIsTeamModalOpen(true); }}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-black py-3 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
            >
              <Plus size={20} />
              Add Member
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamMembers.map((member) => (
              <div key={member.uid} className="bg-[#1E293B] p-6 rounded-3xl border border-slate-800 shadow-xl flex justify-between items-center group">
                <div className="flex items-center gap-4">
                  <div className="bg-slate-900 p-3 rounded-2xl text-indigo-400">
                    <User size={24} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-200">{member.displayName || 'Pending...'}</h3>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{member.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Shield size={12} className="text-indigo-500" />
                      <span className="text-[10px] font-black bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-md uppercase">
                        {member.role === 'admin' ? 'Super Admin' : member.role === 'accountant' ? 'Accountant' : 'Accounts Manager'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Modal */}
      {isTeamModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-lg font-black uppercase tracking-widest">
                Add Team Member
              </h2>
              <button onClick={() => setIsTeamModalOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveTeamMember} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    name="email"
                    type="email"
                    required
                    maxLength={100}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 pl-12 text-sm outline-none focus:border-blue-500"
                    placeholder="member@example.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Display Name</label>
                <input
                  name="displayName"
                  type="text"
                  required
                  maxLength={100}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  placeholder="Full Name"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Role</label>
                <select
                  name="role"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="manager">Accounts Manager</option>
                  <option value="accountant">Accountant (Read Only)</option>
                  <option value="admin">Super Admin</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
              >
                <Save size={20} />
                Save Member
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Currency Settings Modal */}
      {isCurrencySettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md rounded-3xl border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-black uppercase tracking-widest">
                Exchange Rates
              </h2>
              <button onClick={() => setIsCurrencySettingsOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 bg-slate-900 rounded-2xl border border-slate-800">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest">Use Manual Rates</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Override real-time API updates</p>
                </div>
                <button
                  onClick={() => setCurrencySettings({ ...currencySettings, useManualRates: !currencySettings.useManualRates })}
                  className={cn(
                    "w-12 h-6 rounded-full transition-all relative",
                    currencySettings.useManualRates ? "bg-blue-600" : "bg-slate-700"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                    currencySettings.useManualRates ? "right-1" : "left-1"
                  )} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Rates (1 USD = ?)</p>
                  {currencySettings.useManualRates && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="CODE"
                        value={newCurrencyCode}
                        maxLength={10}
                        onChange={(e) => setNewCurrencyCode(e.target.value.toUpperCase())}
                        className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-black text-white outline-none focus:border-blue-500"
                      />
                      <button
                        onClick={() => {
                          if (newCurrencyCode && !currencySettings.rates[newCurrencyCode]) {
                            setCurrencySettings({
                              ...currencySettings,
                              rates: { ...currencySettings.rates, [newCurrencyCode]: 1 }
                            });
                            setNewCurrencyCode('');
                          }
                        }}
                        className="p-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {Object.entries(currencySettings.rates).map(([code, rate]) => (
                  <div key={code} className="flex items-center gap-4 group">
                    <div className="w-16 text-xs font-black text-slate-400 uppercase tracking-widest">{code}</div>
                    <input
                      type="number"
                      value={rate}
                      onChange={(e) => setCurrencySettings({
                        ...currencySettings,
                        rates: { ...currencySettings.rates, [code]: parseFloat(e.target.value) || 0 }
                      })}
                      disabled={!currencySettings.useManualRates}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    />
                    {currencySettings.useManualRates && code !== 'USD' && (
                      <button
                        onClick={() => {
                          const newRates = { ...currencySettings.rates };
                          delete newRates[code];
                          setCurrencySettings({ ...currencySettings, rates: newRates });
                        }}
                        className="p-2 text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-6 bg-slate-900/50 border-t border-slate-800">
              <button
                onClick={handleSaveCurrencySettings}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
              >
                <Save size={20} />
                Save Currency Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Service Modal */}
      {isServiceModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-lg font-black uppercase tracking-widest">
                {editingService ? 'Edit Service' : 'Add Digital Service'}
              </h2>
              <button 
                onClick={() => { setIsServiceModalOpen(false); setEditingService(null); }} 
                className="text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveService} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Select Business</label>
                <select
                  name="businessId"
                  required
                  defaultValue={editingService?.businessId || selectedBusiness?.id || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="" disabled>Select a business</option>
                  {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Service Name</label>
                <input
                  name="name"
                  type="text"
                  required
                  maxLength={100}
                  defaultValue={editingService?.name}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-indigo-500"
                  placeholder="e.g. YouTube Channel, SaaS App"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Service Type</label>
                <select
                  name="type"
                  required
                  defaultValue={editingService?.type || 'other'}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-indigo-500"
                >
                  <option value="subscription">Subscription</option>
                  <option value="commission">Commission</option>
                  <option value="ad_revenue">Ad Revenue</option>
                  <option value="software_sale">Software Sale</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Description</label>
                <input
                  name="description"
                  type="text"
                  maxLength={500}
                  defaultValue={editingService?.description}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-indigo-500"
                  placeholder="Brief description of this revenue stream"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
              >
                <Save size={20} />
                {editingService ? 'Update Service' : 'Save Service'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Branch Modal */}
      {isBranchModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-lg font-black uppercase tracking-widest">
                {editingBranch ? 'Edit Branch' : 'Add New Branch'}
              </h2>
              <button onClick={() => setIsBranchModalOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveBranch} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Select Business</label>
                <select
                  name="businessId"
                  required
                  defaultValue={editingBranch?.businessId || selectedBusiness?.id || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="" disabled>Select a business</option>
                  {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Branch Name</label>
                  <input
                    name="name"
                    type="text"
                    required
                    maxLength={100}
                    defaultValue={editingBranch?.name || ''}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                    placeholder="e.g. Main Branch"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Branch ID/Code</label>
                  <input
                    name="branchCode"
                    type="text"
                    required
                    maxLength={20}
                    defaultValue={editingBranch?.branchCode || ''}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                    placeholder="e.g. BR-001"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Location</label>
                <input
                  name="location"
                  type="text"
                  required
                  maxLength={200}
                  defaultValue={editingBranch?.location || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. Mumbai, India"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Manager Name</label>
                  <input
                    name="managerName"
                    type="text"
                    required
                    maxLength={100}
                    defaultValue={editingBranch?.managerName || ''}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                    placeholder="Full Name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Manager UserID</label>
                  <input
                    name="managerId"
                    type="text"
                    required
                    maxLength={50}
                    defaultValue={editingBranch?.managerId || ''}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                    placeholder="Username"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Manager PIN</label>
                  <input
                    name="managerPin"
                    type="password"
                    required
                    maxLength={6}
                    defaultValue={editingBranch?.managerPin || ''}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                    placeholder="6-digit PIN"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Mobile Number</label>
                  <input
                    name="mobileNumber"
                    type="text"
                    required
                    maxLength={20}
                    defaultValue={editingBranch?.mobileNumber || ''}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                    placeholder="Manager Mobile"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Branch Currency</label>
                <select
                  name="currency"
                  defaultValue={editingBranch?.currency || 'OMR'}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="OMR">OMR (Omani Rial - Default 3 Decimals)</option>
                  <option value="INR">INR (₹ - Indian Rupee)</option>
                  <option value="USD">USD ($ - US Dollar)</option>
                  <option value="SAR">SAR (ر.س - Saudi Riyal)</option>
                  <option value="AED">AED (د.إ - UAE Dirham)</option>
                </select>
                <p className="text-[10px] text-slate-500 italic ml-1">
                  Default currency is OMR. If specified, this branch dashboard and calculations render in this currency.
                </p>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
              >
                <Save size={20} />
                {editingBranch ? 'Update Branch' : 'Save Branch'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Business Modal */}
      {isBusinessModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-base md:text-lg font-black uppercase tracking-widest">
                {editingBusiness ? 'Edit Business Profile' : 'Add New Business'}
              </h2>
              <button onClick={() => setIsBusinessModalOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveBusiness} className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Business Name</label>
                <input
                  name="name"
                  type="text"
                  required
                  maxLength={100}
                  defaultValue={editingBusiness?.name || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. ShomeDesk Corp"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Currency Symbol</label>
                <select
                  name="currency"
                  required
                  defaultValue={editingBusiness?.currency || 'OMR'}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500 appearance-none"
                >
                  <optgroup label="Common">
                    <option value="INR">₹ (INR - India)</option>
                    <option value="USD">$ (USD - US Dollar)</option>
                    <option value="EUR">€ (EUR - Euro)</option>
                    <option value="GBP">£ (GBP - British Pound)</option>
                  </optgroup>
                  <optgroup label="Gulf Countries">
                    <option value="AED">د.إ (AED - UAE Dirham)</option>
                    <option value="SAR">ر.س (SAR - Saudi Riyal)</option>
                    <option value="QAR">ر.ق (QAR - Qatari Riyal)</option>
                    <option value="OMR">ر.ع. (OMR - Omani Rial)</option>
                    <option value="KWD">د.ك (KWD - Kuwaiti Dinar)</option>
                    <option value="BHD">.د.ب (BHD - Bahraini Dinar)</option>
                  </optgroup>
                  <optgroup label="Others">
                    <option value="BDT">৳ (BDT - Bangladesh Taka)</option>
                    <option value="PKR">Rs (PKR - Pakistan Rupee)</option>
                    <option value="LKR">Rs (LKR - Sri Lanka Rupee)</option>
                    <option value="NPR">Rs (NPR - Nepal Rupee)</option>
                    <option value="CAD">$ (CAD - Canada Dollar)</option>
                    <option value="AUD">$ (AUD - Australia Dollar)</option>
                    <option value="SGD">$ (SGD - Singapore Dollar)</option>
                  </optgroup>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Business Mobile</label>
                <input
                  name="mobileNumber"
                  type="text"
                  required
                  maxLength={20}
                  defaultValue={editingBusiness?.mobileNumber || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  placeholder="Business Contact"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-indigo-900/20"
              >
                <Save size={20} />
                {editingBusiness ? 'Update Profile' : 'Create Business'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Bank Modal */}
      {isBankModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-4 md:p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-base md:text-lg font-black uppercase tracking-widest">
                {editingBank ? 'Edit Bank Account' : 'Add Bank Account'}
              </h2>
              <button onClick={() => setIsBankModalOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handleSaveBank} className="p-4 md:p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Select Business</label>
                <select
                  name="businessId"
                  required
                  defaultValue={editingBank?.businessId || selectedBusiness?.id || 'global'}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="global">Company Main (Global)</option>
                  {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Account Name</label>
                <input
                  name="accountName"
                  type="text"
                  required
                  maxLength={100}
                  defaultValue={editingBank?.accountName || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. Operating Account"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Bank Name</label>
                <input
                  name="bankName"
                  type="text"
                  required
                  maxLength={100}
                  defaultValue={editingBank?.bankName || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  placeholder="e.g. HDFC Bank"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Account Number</label>
                <input
                  name="accountNumber"
                  type="text"
                  required
                  maxLength={50}
                  defaultValue={editingBank?.accountNumber || ''}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  placeholder="Last 4 digits or full number"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Link to Branch</label>
                <select
                  name="branchId"
                  defaultValue={editingBank?.branchId || 'global'}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="global">Business Main (Global)</option>
                  {branches.map(br => <option key={br.id} value={br.id}>{br.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Link to Digital Service</label>
                <select
                  name="serviceId"
                  defaultValue={editingBank?.serviceId || 'global'}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                >
                  <option value="global">No Service (Global)</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
              >
                <Save size={20} />
                {editingBank ? 'Update Account' : 'Save Account'}
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Ticker Settings Modal */}
      {isTickerSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md rounded-3xl border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-black uppercase tracking-widest">
                Ticker Settings
              </h2>
              <button onClick={() => setIsTickerSettingsOpen(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="flex items-center justify-between p-5 bg-slate-900 rounded-2xl border border-slate-800">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest">Enable Ticker</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Show scrolling rates at top</p>
                </div>
                <button
                  onClick={() => setTickerSettings({ ...tickerSettings, enabled: !tickerSettings.enabled })}
                  className={cn(
                    "w-12 h-6 rounded-full transition-all relative",
                    tickerSettings.enabled ? "bg-blue-600" : "bg-slate-700"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                    tickerSettings.enabled ? "right-1" : "left-1"
                  )} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Ticker Pairs</p>
                  <button
                    onClick={() => setTickerSettings({
                      ...tickerSettings,
                      pairs: [...tickerSettings.pairs, { from: 'USD', to: 'INR' }]
                    })}
                    className="p-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {tickerSettings.pairs.map((pair, idx) => (
                  <div key={idx} className="flex items-center gap-2 group">
                    <input
                      type="text"
                      value={pair.from}
                      maxLength={10}
                      onChange={(e) => {
                        const newPairs = [...tickerSettings.pairs];
                        newPairs[idx].from = e.target.value.toUpperCase();
                        setTickerSettings({ ...tickerSettings, pairs: newPairs });
                      }}
                      className="w-20 bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs font-black outline-none focus:border-blue-500"
                      placeholder="FROM"
                    />
                    <span className="text-slate-600">/</span>
                    <input
                      type="text"
                      value={pair.to}
                      maxLength={10}
                      onChange={(e) => {
                        const newPairs = [...tickerSettings.pairs];
                        newPairs[idx].to = e.target.value.toUpperCase();
                        setTickerSettings({ ...tickerSettings, pairs: newPairs });
                      }}
                      className="w-20 bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs font-black outline-none focus:border-blue-500"
                      placeholder="TO"
                    />
                    <button
                      onClick={() => {
                        const newPairs = tickerSettings.pairs.filter((_, i) => i !== idx);
                        setTickerSettings({ ...tickerSettings, pairs: newPairs });
                      }}
                      className="p-2 text-slate-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-6 bg-slate-900/50 border-t border-slate-800">
              <button
                onClick={handleSaveTickerSettings}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
              >
                <Save size={20} />
                Save Ticker Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {isConfirmModalOpen && confirmAction && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-sm rounded-3xl border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-800">
              <h2 className="text-lg font-black uppercase tracking-widest text-red-500">
                {confirmAction.title}
              </h2>
            </div>
            <div className="p-6">
              <p className="text-slate-400 font-bold text-sm leading-relaxed">
                {confirmAction.message}
              </p>
            </div>
            <div className="p-6 bg-slate-900/50 flex gap-3">
              <button
                onClick={() => setIsConfirmModalOpen(false)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-black py-3 rounded-2xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmAction.onConfirm();
                  setIsConfirmModalOpen(false);
                }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black py-3 rounded-2xl transition-all shadow-lg shadow-red-900/20"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
