import React, { useState } from 'react';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { auth } from '@/src/lib/firebase';
import { Lock, KeyRound, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

export default function BranchGuard({ children }: { children: React.ReactNode }) {
  const { isBranchAuthenticated, authenticateBranch, selectedBranch, userProfile, loading } = useBusiness();
  const [pin, setPin] = useState('');

  // 1. While business context is loading user profile, show a spinner (NEVER show PIN lock prematurely)
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  // 2. Admin & Authorized Staff Bypass Check:
  // - Default admin email or UID
  // - Admin session flag in sessionStorage / localStorage
  // - Role is admin, manager, or branch_manager
  // - Or any non-anonymous Google-authenticated user
  const isDefaultAdmin = 
    auth.currentUser?.email?.toLowerCase() === 'shomedesk@gmail.com' || 
    auth.currentUser?.uid === '5KH6pWSLtzUakBBDqrv2n5zSr243' ||
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('is_admin_session') === 'true') ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('is_admin_session') === 'true');

  const isPrivilegedUser = 
    isDefaultAdmin ||
    userProfile?.role === 'admin' || 
    userProfile?.role === 'manager' || 
    userProfile?.role === 'branch_manager' || 
    (auth.currentUser && !auth.currentUser.isAnonymous);

  if (isPrivilegedUser) {
    return <>{children}</>;
  }

  if (isBranchAuthenticated) {
    return <>{children}</>;
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (authenticateBranch(pin)) {
      toast.success('Branch access granted');
    } else {
      toast.error('Invalid PIN');
      setPin('');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6">
      <div className="max-w-md w-full bg-[#1E293B] p-8 rounded-[2.5rem] border border-slate-800 shadow-2xl space-y-8 text-center">
        <div className="bg-blue-500/10 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto border border-blue-500/20">
          <Lock size={40} className="text-blue-500" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-black uppercase tracking-tighter">Branch Access</h2>
          <p className="text-slate-400 font-medium text-sm">
            Enter the manager PIN for <span className="text-blue-400 font-bold">{selectedBranch?.name || 'this branch'}</span> to continue.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors">
              <KeyRound size={20} />
            </div>
            <input
              type="password"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter 6-digit PIN"
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-center text-2xl font-black tracking-[1em] focus:border-blue-500 outline-none transition-all placeholder:text-sm placeholder:tracking-normal placeholder:font-bold"
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20 uppercase tracking-widest text-xs"
          >
            Unlock Access
            <ArrowRight size={18} />
          </button>
        </form>

        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
          Authorized Personnel Only
        </p>
      </div>
    </div>
  );
}
