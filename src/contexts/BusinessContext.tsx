import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db, auth } from '@/src/lib/firebase';
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, getDocs, Unsubscribe } from 'firebase/firestore';
import { Business, Branch, UserProfile, BankAccount, Service } from '@/src/types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { syncSalesPlaySalesToFirestore } from '@/src/services/salesplay';
import { subDays } from 'date-fns';

interface BusinessContextType {
  businesses: Business[];
  branches: Branch[];
  services: Service[];
  bankAccounts: BankAccount[];
  selectedBusiness: Business | null;
  isAllBusinessesSelected: boolean;
  selectedBranch: Branch | null; // null means "All Branches"
  selectedService: Service | null;
  userProfile: UserProfile | null;
  isBranchAuthenticated: boolean;
  authenticateBranch: (pin: string) => boolean;
  setSelectedBusiness: (business: Business | null) => void;
  setSelectedBranch: (branch: Branch | null) => void;
  setSelectedService: (service: Service | null) => void;
  setAllBusinessesSelected: (selected: boolean) => void;
  loading: boolean;
}

const BusinessContext = createContext<BusinessContextType | undefined>(undefined);

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [user] = useAuthState(auth);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBusiness, _setSelectedBusiness] = useState<Business | null>(null);
  const [isAllBusinessesSelected, setIsAllBusinessesSelected] = useState(false);
  const [selectedBranch, _setSelectedBranch] = useState<Branch | null>(null);
  const [selectedService, _setSelectedService] = useState<Service | null>(null);

  const setAllBusinessesSelected = (selected: boolean) => {
    setIsAllBusinessesSelected(selected);
    if (selected) {
      _setSelectedBusiness(null);
      _setSelectedBranch(null);
      _setSelectedService(null);
    }
  };

  const setSelectedBusiness = async (business: Business | null) => {
    _setSelectedBusiness(business);
    setIsAllBusinessesSelected(false);
    _setSelectedBranch(null);
    _setSelectedService(null);
    if (user && business && userProfile?.role !== 'branch_manager') {
      try {
        await updateDoc(doc(db, 'users', user.uid), { businessId: business.id });
      } catch (error) {
        console.error('Failed to update user profile businessId:', error);
      }
    }
  };

  const setSelectedBranch = async (branch: Branch | null) => {
    _setSelectedBranch(branch);
    if (branch) _setSelectedService(null);
    if (user && branch && userProfile?.role !== 'branch_manager') {
      try {
        await updateDoc(doc(db, 'users', user.uid), { branchId: branch.id });
      } catch (error) {
        console.error('Failed to update user profile branchId:', error);
      }
    } else if (user && !branch && userProfile?.role !== 'branch_manager') {
      try {
        await updateDoc(doc(db, 'users', user.uid), { branchId: null });
      } catch (error) {
        console.error('Failed to clear user profile branchId:', error);
      }
    }
  };
  const setSelectedService = (service: Service | null) => {
    _setSelectedService(service);
    if (service) _setSelectedBranch(null);
  };

  const [loading, setLoading] = useState(true);
  const [isBranchAuthenticated, setIsBranchAuthenticated] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  const nestedUnsubRef = useRef<Unsubscribe | null>(null);

  useEffect(() => {
    if (!user) {
      setBusinesses([]);
      setBranches([]);
      setServices([]);
      setBankAccounts([]);
      _setSelectedBusiness(null);
      _setSelectedBranch(null);
      _setSelectedService(null);
      setUserProfile(null);
      setLoading(false);
      if (nestedUnsubRef.current) {
        nestedUnsubRef.current();
        nestedUnsubRef.current = null;
      }
      return;
    }

    setLoading(true);
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), async (docSnap) => {
      if (docSnap.exists()) {
        const profile = docSnap.data() as UserProfile;
        
        // Auto-fix: if admin and ownedBusinessIds is missing
        if (profile.role === 'admin' && !profile.ownedBusinessIds) {
          try {
            const bQuery = query(collection(db, 'businesses'), where('ownerId', '==', user.uid));
            const bSnap = await getDocs(bQuery);
            const ids = bSnap.docs.map(d => d.id);
            await updateDoc(doc(db, 'users', user.uid), { ownedBusinessIds: ids });
            profile.ownedBusinessIds = ids;
          } catch (err) {
            console.error('Failed to auto-fix ownedBusinessIds:', err);
          }
        }
        
        setUserProfile(profile);

        // Cleanup previous nested subscription
        if (nestedUnsubRef.current) {
          nestedUnsubRef.current();
          nestedUnsubRef.current = null;
        }

        if (profile.role === 'branch_manager') {
          // Branch Manager: Fetch only the assigned business and branch
          const bRef = doc(db, 'businesses', profile.businessId);
          const brRef = doc(db, 'branches', profile.branchId);

          // Use onSnapshot for business to handle real-time updates
          const unsubB = onSnapshot(bRef, (bSnap) => {
            if (bSnap.exists()) {
              const bData = { id: bSnap.id, ...bSnap.data() } as Business;
              setBusinesses([bData]);
              _setSelectedBusiness(bData);
            }
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, `businesses/${profile.businessId}`);
          });

          // Use onSnapshot for branch to handle real-time updates
          const unsubBr = onSnapshot(brRef, (brSnap) => {
            if (brSnap.exists()) {
              const brData = { id: brSnap.id, ...brSnap.data() } as Branch;
              setBranches([brData]);
              _setSelectedBranch(brData);
            }
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, `branches/${profile.branchId}`);
          });

          nestedUnsubRef.current = () => {
            unsubB();
            unsubBr();
          };
          setLoading(false);
        } else {
          // Admin or Accounts Manager: Fetch all businesses
          if (profile.role === 'admin') {
            const bQuery = collection(db, 'businesses');
            nestedUnsubRef.current = onSnapshot(bQuery, (snapshot) => {
              const bList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Business));
              setBusinesses(bList);
              if (bList.length > 0 && !selectedBusiness) {
                const target = bList.find(b => b.id === 'j2S1dqdU9W3WAdd7KXyk') || bList[0];
                _setSelectedBusiness(target);
              }
              setLoading(false);
            }, (error) => {
              handleFirestoreError(error, OperationType.LIST, 'businesses');
            });
          } else {
            // Manager assigned to one business
            const bRef = doc(db, 'businesses', profile.businessId || 'j2S1dqdU9W3WAdd7KXyk');
            nestedUnsubRef.current = onSnapshot(bRef, (docSnap) => {
              if (docSnap.exists()) {
                const bData = { id: docSnap.id, ...docSnap.data() } as Business;
                setBusinesses([bData]);
                if (!selectedBusiness) {
                  _setSelectedBusiness(bData);
                }
              }
              setLoading(false);
            }, (error) => {
              handleFirestoreError(error, OperationType.GET, `businesses/${profile.businessId}`);
            });
          }
        }
      } else {
        const isAdminSession = 
          (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('is_admin_session') === 'true') ||
          (typeof localStorage !== 'undefined' && localStorage.getItem('is_admin_session') === 'true');
        const isDefault = isAdminSession || user.email?.toLowerCase() === 'shomedesk@gmail.com' || user.uid === '5KH6pWSLtzUakBBDqrv2n5zSr243' || (!user.isAnonymous && user.email);
        if (isDefault) {
          setUserProfile({
            uid: user.uid,
            email: user.email || 'admin@shomedesk.com',
            displayName: user.displayName || 'Administrator',
            role: 'admin',
            businessId: 'j2S1dqdU9W3WAdd7KXyk',
            branchId: 'kZW07zMAVPglK98ruycB',
            ownedBusinessIds: ['j2S1dqdU9W3WAdd7KXyk']
          });

          // Fetch businesses for this admin
          const unsubB = onSnapshot(collection(db, 'businesses'), (bSnap) => {
            const bList = bSnap.docs.map(d => ({ id: d.id, ...d.data() } as Business));
            setBusinesses(bList);
            if (bList.length > 0 && !selectedBusiness) {
              const target = bList.find(b => b.id === 'j2S1dqdU9W3WAdd7KXyk') || bList[0];
              _setSelectedBusiness(target);
            }
          });
          nestedUnsubRef.current = unsubB;
        }
        setLoading(false);
      }
    }, (error) => {
      console.warn('Notice fetching user profile snapshot:', error);
      const isAdminSession = 
        (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('is_admin_session') === 'true') ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('is_admin_session') === 'true');
      const isDefault = isAdminSession || user.email?.toLowerCase() === 'shomedesk@gmail.com' || user.uid === '5KH6pWSLtzUakBBDqrv2n5zSr243' || (!user.isAnonymous && user.email);
      if (isDefault) {
        setUserProfile({
          uid: user.uid,
          email: user.email || 'admin@shomedesk.com',
          displayName: user.displayName || 'Administrator',
          role: 'admin',
          businessId: 'j2S1dqdU9W3WAdd7KXyk',
          branchId: 'kZW07zMAVPglK98ruycB',
          ownedBusinessIds: ['j2S1dqdU9W3WAdd7KXyk']
        });

        const unsubB = onSnapshot(collection(db, 'businesses'), (bSnap) => {
          const bList = bSnap.docs.map(d => ({ id: d.id, ...d.data() } as Business));
          setBusinesses(bList);
          if (bList.length > 0 && !selectedBusiness) {
            const target = bList.find(b => b.id === 'j2S1dqdU9W3WAdd7KXyk') || bList[0];
            _setSelectedBusiness(target);
          }
        });
        nestedUnsubRef.current = unsubB;
      }
      setLoading(false);
    });

    return () => {
      unsubProfile();
      if (nestedUnsubRef.current) {
        nestedUnsubRef.current();
        nestedUnsubRef.current = null;
      }
    };
  }, [user]);

  useEffect(() => {
    if (!selectedBusiness && !isAllBusinessesSelected) {
      setBranches([]);
      setBankAccounts([]);
      _setSelectedBranch(null);
      return;
    }

    if (isAllBusinessesSelected) {
      // Fetch all branches for all businesses
      const brQuery = query(collection(db, 'branches'), where('businessId', 'in', businesses.map(b => b.id).slice(0, 10))); // Firestore 'in' limit is 10
      const unsubBr = onSnapshot(brQuery, (snapshot) => {
        const brList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Branch));
        setBranches(brList);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'branches');
      });

      // Fetch all services for all businesses
      const sQuery = query(collection(db, 'services'), where('businessId', 'in', businesses.map(b => b.id).slice(0, 10)));
      const unsubS = onSnapshot(sQuery, (snapshot) => {
        const sList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Service));
        setServices(sList);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'services');
      });

      // Fetch all bank accounts for all businesses + global accounts
      const targetBizIds = businesses.map(b => b.id).slice(0, 9);
      const baQuery = targetBizIds.length > 0
        ? query(collection(db, 'bankAccounts'), where('businessId', 'in', [...targetBizIds, 'global']))
        : query(collection(db, 'bankAccounts'), where('businessId', '==', 'j2S1dqdU9W3WAdd7KXyk'));
      const unsubBa = onSnapshot(baQuery, (snapshot) => {
        const baList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
        // Filter for either business accounts or global accounts
        const filtered = baList.filter(ba => 
          ba.businessId === 'global' || businesses.some(b => b.id === ba.businessId)
        );
        setBankAccounts(filtered);
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'bankAccounts');
      });

      return () => {
        unsubBr();
        unsubS();
        unsubBa();
      };
    } else {
      // Fetch branches for selected business
      const brQuery = query(collection(db, 'branches'), where('businessId', '==', selectedBusiness!.id));
      const unsubBr = onSnapshot(brQuery, (snapshot) => {
        const brList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Branch));
        setBranches(brList);
        if (brList.length > 0 && !selectedBranch) {
          const target = brList.find(b => b.id === 'kZW07zMAVPglK98ruycB') || brList[0];
          _setSelectedBranch(target);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `branches?businessId=${selectedBusiness!.id}`);
      });

      // Fetch services for selected business
      const sQuery = query(collection(db, 'services'), where('businessId', '==', selectedBusiness!.id));
      const unsubS = onSnapshot(sQuery, (snapshot) => {
        const sList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Service));
        setServices(sList);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `services?businessId=${selectedBusiness!.id}`);
      });

      // Fetch bank accounts for selected business + global accounts
      const targetBizId = selectedBusiness?.id || userProfile?.businessId || 'j2S1dqdU9W3WAdd7KXyk';
      
      const baQuery = query(collection(db, 'bankAccounts'), where('businessId', '==', targetBizId));

      const unsubBa = onSnapshot(baQuery, (snapshot) => {
        const baList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
        // Filter for either the selected business or global accounts
        const filtered = baList.filter(ba => 
          ba.businessId === 'global' || ba.businessId === targetBizId
        );
        setBankAccounts(filtered.length > 0 ? filtered : baList);
        setLoading(false);
      }, (error) => {
        console.warn('Bank accounts subscription notice:', error);
        setLoading(false);
      });

      return () => {
        unsubBr();
        unsubS();
        unsubBa();
      };
    }
  }, [selectedBusiness, isAllBusinessesSelected, businesses, userProfile]);

  // Auto-Sync SalesPlay POS on app load / business selection in background
  useEffect(() => {
    if (!selectedBusiness?.id || !user) return;
    let didCancel = false;

    async function autoSync() {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          console.log('App is offline, skipping background SalesPlay auto-sync');
          return;
        }
        const now = new Date();
        const start = subDays(now, 14); // Sync last 14 days
        const res = await syncSalesPlaySalesToFirestore({
          businessId: selectedBusiness!.id,
          ownerId: selectedBusiness!.ownerId || user.uid,
          branchId: selectedBranch?.id || 'kZW07zMAVPglK98ruycB',
          startDate: start,
          endDate: now,
        });
        if (!didCancel && res.success && res.importedCount > 0) {
          console.log(`Auto-synced ${res.importedCount} SalesPlay receipts to Firestore 'sales' collection`);
        }
      } catch (err) {
        console.warn('Silent notice during background SalesPlay auto-sync:', err);
      }
    }

    const timer = setTimeout(() => {
      autoSync();
    }, 1500);

    return () => {
      didCancel = true;
      clearTimeout(timer);
    };
  }, [selectedBusiness?.id, selectedBranch?.id, user]);

  const isPrivilegedRole = 
    userProfile?.role === 'admin' ||
    userProfile?.role === 'manager' ||
    userProfile?.role === 'branch_manager' ||
    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('is_admin_session') === 'true') ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('is_admin_session') === 'true') ||
    user?.email?.toLowerCase() === 'shomedesk@gmail.com' ||
    user?.uid === '5KH6pWSLtzUakBBDqrv2n5zSr243';

  // Automatically keep branch authenticated for admins & managers (never ask PIN)
  useEffect(() => {
    if (isPrivilegedRole) {
      setIsBranchAuthenticated(true);
    } else {
      setIsBranchAuthenticated(false);
    }
  }, [selectedBranch?.id, isPrivilegedRole]);

  const authenticateBranch = (pin: string) => {
    if (isPrivilegedRole) {
      setIsBranchAuthenticated(true);
      return true;
    }
    if (selectedBranch && selectedBranch.managerPin === pin) {
      setIsBranchAuthenticated(true);
      return true;
    }
    return false;
  };

  return (
    <BusinessContext.Provider value={{
      businesses,
      branches,
      services,
      bankAccounts,
      selectedBusiness,
      isAllBusinessesSelected,
      selectedBranch,
      selectedService,
      userProfile,
      setSelectedBusiness,
      setSelectedBranch,
      setSelectedService,
      setAllBusinessesSelected,
      isBranchAuthenticated,
      authenticateBranch,
      loading
    }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (context === undefined) {
    throw new Error('useBusiness must be used within a BusinessProvider');
  }
  return context;
}
