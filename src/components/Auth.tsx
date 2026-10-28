import React, { useState } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { GoogleAuthProvider, signInWithPopup, signInAnonymously } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, addDoc, serverTimestamp, query, where, getDocs, deleteDoc, limit } from 'firebase/firestore';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { LogIn, User, Key, Building2 } from 'lucide-react';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';

export default function Auth() {
  const [isManagerLogin, setIsManagerLogin] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [adminPinLoading, setAdminPinLoading] = useState(false);
  const [managerId, setManagerId] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const navigate = useNavigate();

  const handleSuccessfulUserLogin = async (user: any) => {
    // Check if user profile exists by UID
    const userRef = doc(db, 'users', user.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (error) {
      console.warn('Silent notice fetching user doc by UID:', error);
    }

    if (userSnap?.exists()) {
      const userData = userSnap.data();
      if (userData.role === 'admin') {
        sessionStorage.setItem('is_admin_session', 'true');
        localStorage.setItem('is_admin_session', 'true');
      }
      // If manager or branch_manager, redirect immediately before global data fetches
      if (userData.role === 'manager' || userData.role === 'branch_manager') {
        toast.success(`Welcome, ${userData.displayName || 'Manager'}`);
        navigate('/');
        return;
      }
    } else {
      // Check if a placeholder profile exists by email (doc ID is the email)
      const userEmail = (user.email || '').toLowerCase().trim();
      const placeholderRef = doc(db, 'users', userEmail);
      let placeholderSnap;
      try {
        placeholderSnap = await getDoc(placeholderRef);
      } catch (e) {
        console.warn('Silent notice fetching placeholder doc:', e);
      }

      if (placeholderSnap?.exists()) {
        const placeholderData = placeholderSnap.data();
        const userRole = placeholderData.role || 'manager';
        if (userRole === 'admin') {
          sessionStorage.setItem('is_admin_session', 'true');
          localStorage.setItem('is_admin_session', 'true');
        }
        
        // Create real UID doc with placeholder data
        await setDoc(userRef, {
          ...placeholderData,
          uid: user.uid,
          displayName: user.displayName || placeholderData.displayName,
          isPlaceholder: false,
          ownedBusinessIds: placeholderData.ownedBusinessIds || []
        });
        
        // Delete the email-based placeholder safely
        try {
          await deleteDoc(placeholderRef);
        } catch (_) {
          // ignore if rules disallow deletion
        }

        if (userRole === 'manager' || userRole === 'branch_manager') {
          toast.success(`Welcome, ${user.displayName || placeholderData.displayName || 'Manager'}`);
          navigate('/');
          return;
        }
      } else {
        // Automatically link admin business & profile to MAKAREM ALKHAIR MODERN
        try {
          const bSnap = await getDocs(collection(db, 'businesses'));
          let bizId = 'j2S1dqdU9W3WAdd7KXyk';
          let brId = 'kZW07zMAVPglK98ruycB';
          if (!bSnap.empty) {
            const found = bSnap.docs.find(d => d.id === 'j2S1dqdU9W3WAdd7KXyk') || bSnap.docs[0];
            bizId = found.id;
            const brSnap = await getDocs(query(collection(db, 'branches'), where('businessId', '==', bizId)));
            if (!brSnap.empty) {
              const foundBr = brSnap.docs.find(d => d.id === 'kZW07zMAVPglK98ruycB') || brSnap.docs[0];
              brId = foundBr.id;
            }
          }

          await setDoc(userRef, {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || 'Admin',
            role: 'admin',
            businessId: bizId,
            branchId: brId,
            ownedBusinessIds: [bizId]
          });

          sessionStorage.setItem('is_admin_session', 'true');
          localStorage.setItem('is_admin_session', 'true');
        } catch (setupErr) {
          console.warn('Silent notice setting up admin user profile:', setupErr);
        }
      }
    }

    sessionStorage.setItem('is_admin_session', 'true');
    localStorage.setItem('is_admin_session', 'true');
    toast.success('Logged in successfully');
    navigate('/');
  };

  const handleGoogleLogin = async () => {
    if (isGoogleSigningIn) return;
    setIsGoogleSigningIn(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });

      let user = auth.currentUser;
      if (!user) {
        try {
          const result = await signInWithPopup(auth, provider);
          user = result.user;
        } catch (popupError: any) {
          const popupMsg = popupError?.message || String(popupError);
          const popupCode = popupError?.code || '';

          // If the Firebase race condition happened or popup was cancelled, check if currentUser populated
          if (auth.currentUser) {
            user = auth.currentUser;
          } else if (
            popupCode === 'auth/popup-closed-by-user' ||
            popupCode === 'auth/cancelled-popup-request' ||
            popupMsg.includes('Pending promise was never set') ||
            popupMsg.includes('INTERNAL ASSERTION FAILED')
          ) {
            // Give a short tick for auth state to sync in case credential exchange completed
            await new Promise(resolve => setTimeout(resolve, 350));
            if (auth.currentUser) {
              user = auth.currentUser;
            } else {
              toast.info('Sign-in popup was closed or cancelled.');
              setIsGoogleSigningIn(false);
              return;
            }
          } else {
            throw popupError;
          }
        }
      }

      if (user) {
        await handleSuccessfulUserLogin(user);
      }
    } catch (error: any) {
      console.warn('Google login notice:', error);
      const errMsg = error?.message || String(error);
      const isPerm = errMsg.toLowerCase().includes('permission') || error?.code === 'permission-denied';
      if (isPerm && auth.currentUser) {
        // Stop false "Login failed" popup on permission warnings when auth is actually successful
        navigate('/');
        return;
      }
      if (auth.currentUser) {
        navigate('/');
        return;
      }
      toast.error('Login failed. Please check popup permissions and try again.');
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleAdminPinLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const pin = adminPin.trim();
    if (!pin) {
      toast.error('Please enter Admin PIN');
      return;
    }
    setAdminPinLoading(true);

    try {
      // Find branch or business
      let bizId = '';
      let branchId = '';

      try {
        const brSnap = await getDocs(query(collection(db, 'branches'), limit(20)));
        const match = brSnap.docs.find(d => {
          const dData = d.data();
          return (dData.managerPin === pin && dData.managerId?.toLowerCase() === 'admin') || dData.managerPin === pin;
        });

        if (match) {
          branchId = match.id;
          bizId = match.data().businessId;
        } else if (pin === '123456') {
          if (!brSnap.empty) {
            branchId = brSnap.docs[0].id;
            bizId = brSnap.docs[0].data().businessId;
          }
        }
      } catch (e) {
        console.warn('Branch check notice during admin pin login:', e);
      }

      if (!bizId) {
        try {
          const bSnap = await getDocs(query(collection(db, 'businesses'), limit(1)));
          if (!bSnap.empty) {
            bizId = bSnap.docs[0].id;
          }
        } catch (_) {}
      }

      // Check pin validity: 123456 (default) or matched branch pin
      if (!branchId && pin !== '123456') {
        toast.error('Invalid Admin PIN (Default: 123456)');
        setAdminPinLoading(false);
        return;
      }

      let currentUser = auth.currentUser;
      if (!currentUser) {
        const authResult = await signInAnonymously(auth);
        currentUser = authResult.user;
      }

      // Set user profile as full ADMIN
      await setDoc(doc(db, 'users', currentUser.uid), {
        uid: currentUser.uid,
        email: 'admin@shomedesk.com',
        displayName: 'Administrator',
        role: 'admin',
        businessId: bizId || '',
        branchId: branchId || '',
        ownedBusinessIds: bizId ? [bizId] : []
      });

      sessionStorage.setItem('is_admin_session', 'true');
      localStorage.setItem('is_admin_session', 'true');

      toast.success('Welcome, Administrator');
      navigate('/');
    } catch (error: any) {
      console.error('Admin PIN login error:', error);
      toast.error('Admin login failed. Please check credentials.');
    } finally {
      setAdminPinLoading(false);
    }
  };

  const handleManagerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(false);
    setLoading(true);
    try {
      // First, try to find the branch WITHOUT auth (rules must allow this specific query)
      const loginQuery = query(
        collection(db, 'branches'), 
        where('managerId', '==', managerId),
        where('managerPin', '==', managerPin),
        limit(1)
      );
      
      let querySnapshot;
      try {
        querySnapshot = await getDocs(loginQuery);
      } catch (err: any) {
        // If unauthenticated query fails, try signing in anonymously first
        try {
          await signInAnonymously(auth);
          querySnapshot = await getDocs(loginQuery);
        } catch (authErr: any) {
          if (authErr.code === 'auth/admin-restricted-operation' || authErr.code === 'auth/operation-not-allowed') {
            throw new Error('MANAGER_LOGIN_DISABLED');
          }
          handleFirestoreError(authErr, OperationType.LIST, 'branches');
        }
      }

      if (querySnapshot.empty) {
        await auth.signOut();
        toast.error('Invalid UserID or PIN');
        return;
      }

      const branchDoc = querySnapshot.docs[0];
      const branchData = branchDoc.data();

      // Ensure we are signed in (anonymously) to create the profile
      let currentUser = auth.currentUser;
      if (!currentUser) {
        const authResult = await signInAnonymously(auth);
        currentUser = authResult.user;
      }

      // Check if user is logging in with admin UserID
      const isLoggingInAsAdmin = managerId.trim().toLowerCase() === 'admin' || managerId.trim().toLowerCase() === 'owner';
      const userRole = isLoggingInAsAdmin ? 'admin' : 'branch_manager';

      // Create/Update profile for this session
      await setDoc(doc(db, 'users', currentUser.uid), {
        uid: currentUser.uid,
        email: isLoggingInAsAdmin ? 'admin@shomedesk.com' : `manager_${managerId}@shomedesk.com`,
        displayName: branchData.managerName || (isLoggingInAsAdmin ? 'Administrator' : 'Manager'),
        role: userRole,
        businessId: branchData.businessId,
        branchId: branchDoc.id,
        ownedBusinessIds: [branchData.businessId]
      });

      if (isLoggingInAsAdmin) {
        sessionStorage.setItem('is_admin_session', 'true');
        localStorage.setItem('is_admin_session', 'true');
      }

      toast.success(isLoggingInAsAdmin ? 'Welcome, Administrator' : `Welcome, ${branchData.managerName}`);
      navigate('/');
    } catch (error: any) {
      console.error('Manager login error:', error);
      if (error.message === 'MANAGER_LOGIN_DISABLED' || error.code === 'auth/admin-restricted-operation' || error.code === 'auth/operation-not-allowed') {
        toast.error(
          <div className="space-y-2">
            <p className="font-bold">Manager login is currently disabled.</p>
            <p className="text-xs">Please enable "Anonymous Authentication" in the Firebase Console:</p>
            <a 
              href="https://console.firebase.google.com/project/mytobo/authentication/providers" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-400 underline text-xs block mt-1"
            >
              Open Firebase Console
            </a>
          </div>,
          { duration: 10000 }
        );
      } else {
        toast.error('Manager login failed. Please check your credentials and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex flex-col items-center justify-center p-6 text-slate-50">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-black tracking-tighter text-blue-500">
            SHOMEDESK
          </h1>
          <p className="text-slate-400 font-medium uppercase tracking-widest text-sm">
            SaaS Business Management
          </p>
        </div>

        <div className="bg-[#1E293B] p-8 rounded-3xl border border-slate-800 shadow-2xl space-y-6">
          <div className="flex bg-slate-900 p-1 rounded-2xl">
            <button 
              onClick={() => setIsManagerLogin(false)}
              className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${!isManagerLogin ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Admin Login
            </button>
            <button 
              onClick={() => setIsManagerLogin(true)}
              className={`flex-1 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${isManagerLogin ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Manager Login
            </button>
          </div>

          {!isManagerLogin ? (
            <div className="space-y-5">
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isGoogleSigningIn}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20 cursor-pointer"
              >
                {isGoogleSigningIn ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <LogIn size={20} />
                )}
                <span>{isGoogleSigningIn ? 'Connecting to Google...' : 'Sign in with Google'}</span>
              </button>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-800" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">OR WITH ADMIN PIN</span>
                <div className="h-px flex-1 bg-slate-800" />
              </div>

              <form onSubmit={handleAdminPinLogin} className="space-y-4 text-left">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Admin 6-Digit PIN</label>
                    <span className="text-[10px] font-bold text-slate-500">Default: 123456</span>
                  </div>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input
                      type="password"
                      required
                      maxLength={6}
                      value={adminPin}
                      onChange={(e) => setAdminPin(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3.5 pl-12 text-sm outline-none focus:border-blue-500 text-slate-100 placeholder:text-slate-600 tracking-widest font-mono"
                      placeholder="Enter PIN (e.g. 123456)"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={adminPinLoading}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all active:scale-95 border border-slate-700"
                >
                  {adminPinLoading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Building2 size={18} className="text-blue-400" />
                  )}
                  <span>Access Admin Portal</span>
                </button>
              </form>
            </div>
          ) : (
            <form onSubmit={handleManagerLogin} className="space-y-4 text-left">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Manager UserID</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="text"
                    required
                    value={managerId}
                    onChange={(e) => setManagerId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 pl-12 text-sm outline-none focus:border-blue-500"
                    placeholder="Enter your UserID"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Manager PIN</label>
                <div className="relative">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <input
                    type="password"
                    required
                    maxLength={6}
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 pl-12 text-sm outline-none focus:border-blue-500"
                    placeholder="Enter 6-digit PIN"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
              >
                <Building2 size={20} />
                Enter Manager Portal
              </button>
            </form>
          )}
        </div>

        <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest">
          Enterprise Grade Security
        </p>
      </div>
    </div>
  );
}
