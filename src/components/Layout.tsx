import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { db } from '@/src/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { 
  Home, 
  FileText, 
  Package, 
  LayoutDashboard, 
  LogOut, 
  Settings, 
  ChevronDown, 
  Building2, 
  Wallet, 
  Landmark, 
  History,
  Menu,
  X,
  CreditCard,
  Briefcase,
  CheckSquare,
  Brain,
  Users,
  DollarSign,
  Shield,
  FileDown,
  Banknote,
  Coins,
  Calculator,
  Globe,
  ShoppingBag
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { auth } from '@/src/lib/firebase';
import { signOut } from 'firebase/auth';
import { toast } from 'sonner';
import { useBusiness } from '@/src/contexts/BusinessContext';
import NotificationCenter from './NotificationCenter';
import CurrencyTicker from './CurrencyTicker';
import BusinessAssistant from './BusinessAssistant';
import { PWAInstallButton } from './PWAInstallButton';

export default function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(typeof window !== 'undefined' ? window.innerWidth >= 1024 : false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { 
    businesses, 
    branches, 
    services,
    selectedBusiness, 
    isAllBusinessesSelected,
    selectedBranch, 
    selectedService,
    setSelectedBusiness, 
    setSelectedBranch, 
    setSelectedService,
    setAllBusinessesSelected,
    userProfile 
  } = useBusiness();
  const navigate = useNavigate();

  // Document Renewal Alerts
  useEffect(() => {
    if (!userProfile?.businessId || !selectedBusiness) return;

    const checkExpiringDocs = async () => {
      try {
        const q = query(
          collection(db, 'branchDocuments'),
          where('businessId', '==', selectedBusiness.id)
        );
        
        const snapshot = await getDocs(q);
        const now = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(now.getDate() + 30);

        for (const docSnap of snapshot.docs) {
          const docData = docSnap.data();
          const renewalDate = new Date(docData.nextRenewalDate);
          
          if (renewalDate <= thirtyDaysFromNow) {
            const daysLeft = Math.ceil((renewalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            
            // Create notification if it doesn't exist for today
            const todayStr = now.toISOString().split('T')[0];
            const notificationId = `renewal_${docSnap.id}_${todayStr}`;
            
            // Check if already notified today
            const notifRef = doc(db, 'notifications', notificationId);
            try {
              const notifSnap = await getDoc(notifRef);
              if (!notifSnap.exists()) {
                await setDoc(notifRef, {
                  businessId: selectedBusiness.id,
                  title: 'Document Renewal Alert',
                  message: `Document "${docData.name}" (${docData.documentNumber}) is expiring in ${daysLeft} days.`,
                  type: 'system',
                  status: 'unread',
                  link: '/vault',
                  createdAt: serverTimestamp(),
                  userId: 'system' // System wide for admins/managers
                });
              }
            } catch (readErr) {
              // Ignore transient read errors while offline or connecting
            }
          }
        }
      } catch (error) {
        console.warn('Notice checking expiring docs:', error);
      }
    };

    checkExpiringDocs();
  }, [userProfile, selectedBusiness]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success('Logged out successfully');
      navigate('/');
    } catch (error) {
      toast.error('Logout failed');
    }
  };

  const isBranchManager = userProfile?.role === 'branch_manager';

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-50 flex flex-col font-sans overflow-hidden relative">
      <CurrencyTicker />
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Sidebar Overlay */}
        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] lg:hidden"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={cn(
          "bg-[#1E293B] border-r border-slate-800 transition-all duration-300 flex flex-col z-[70] fixed lg:relative h-full",
          isMobileMenuOpen ? "translate-x-0 w-64" : "-translate-x-full lg:translate-x-0",
          isSidebarOpen ? "lg:w-64" : "lg:w-20"
        )}>
          <div className="p-4 md:p-6 flex items-center justify-between border-b border-slate-800">
            {(isSidebarOpen || isMobileMenuOpen) ? (
              <div className="text-lg md:text-xl font-extrabold tracking-tight">
                SHOME<span className="text-blue-500">DESK</span>
              </div>
            ) : (
              <div className="text-xl font-extrabold text-blue-500">SD</div>
            )}
            <button 
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setIsMobileMenuOpen(false);
                } else {
                  setIsSidebarOpen(!isSidebarOpen);
                }
              }} 
              className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              {(isSidebarOpen || isMobileMenuOpen) ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>

        {/* Business/Branch Switcher - Hidden for Branch Managers */}
        {(isSidebarOpen || isMobileMenuOpen) && !isBranchManager && (
          <div className="p-4 space-y-4 border-b border-slate-800">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Business</label>
              {businesses.length <= 1 ? (
                <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span className="truncate">{businesses[0]?.name || selectedBusiness?.name || 'MAKAREM ALKHAIR MODERN'}</span>
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">PRIMARY</span>
                </div>
              ) : (
                <select 
                  value={isAllBusinessesSelected ? 'all' : (selectedBusiness?.id || '')} 
                  onChange={(e) => {
                    if (e.target.value === 'all') {
                      setAllBusinessesSelected(true);
                    } else {
                      setSelectedBusiness(businesses.find(b => b.id === e.target.value) || null);
                    }
                  }}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs font-bold outline-none focus:border-blue-500"
                >
                  {!isBranchManager && <option value="all">All Businesses (Global)</option>}
                  {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Branch</label>
              {branches.length <= 1 ? (
                <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs font-bold text-slate-200 flex items-center justify-between">
                  <span className="truncate">{branches[0]?.name || selectedBranch?.name || 'Kaburah Branch'}</span>
                  <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">ACTIVE</span>
                </div>
              ) : (
                <select 
                  value={selectedBranch?.id || ''} 
                  onChange={(e) => setSelectedBranch(branches.find(br => br.id === e.target.value) || null)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs font-bold outline-none focus:border-blue-500"
                >
                  <option value="">All Branches</option>
                  {branches.map(br => <option key={br.id} value={br.id}>{br.name}</option>)}
                </select>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Digital Service</label>
              <select 
                value={selectedService?.id || ''} 
                onChange={(e) => setSelectedService(services.find(s => s.id === e.target.value) || null)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs font-bold outline-none focus:border-blue-500"
              >
                <option value="">No Service</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {(isSidebarOpen || isMobileMenuOpen) && isBranchManager && selectedBranch && (
          <div className="p-4 border-b border-slate-800">
            <div className="bg-slate-900/50 p-3 rounded-2xl border border-slate-800">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Active Branch</p>
              <p className="text-sm font-black text-blue-400 truncate">{selectedBranch.name}</p>
              <p className="text-[10px] font-bold text-slate-500 truncate">{selectedBranch.location}</p>
            </div>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          {!isBranchManager ? (
            <>
              <SidebarItem to="/" icon={<Home size={20} />} label="Home" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
              <SidebarItem to="/dashboard" icon={<LayoutDashboard size={20} />} label="Dashboard" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
              
              <div className="pt-4 pb-2">
                <p className={cn("text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-2", !(isSidebarOpen || isMobileMenuOpen) && "hidden")}>Finance</p>
                <SidebarItem to="/finance/cash" icon={<Wallet size={20} />} label="Cash Account" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/finance/bank" icon={<Landmark size={20} />} label="Bank Account" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/cash-count" icon={<Calculator size={20} />} label="Cash Count" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/finance/transactions" icon={<History size={20} />} label="Transactions" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
              </div>

              <div className="pt-4 pb-2">
                <p className={cn("text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-2", !(isSidebarOpen || isMobileMenuOpen) && "hidden")}>Operations</p>
                <SidebarItem to="/sales" icon={<ShoppingBag size={20} />} label="Sales / POS" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/tasks" icon={<CheckSquare size={20} />} label="Daily Tasks" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/vault" icon={<Shield size={20} />} label="Document Vault" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/payroll" icon={<DollarSign size={20} />} label="Payroll" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/report" icon={<FileText size={20} />} label="Daily Reports" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/reports" icon={<FileDown size={20} />} label="Business Reports" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/suppliers" icon={<Package size={20} />} label="Suppliers" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
              </div>

              <div className="pt-4 pb-2">
                <p className={cn("text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-2", !(isSidebarOpen || isMobileMenuOpen) && "hidden")}>Intelligence</p>
                <SidebarItem to="/audit" icon={<Brain size={20} />} label="AI Audit" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
              </div>

              {userProfile?.role !== 'accountant' && (
                <div className="pt-4 pb-2">
                  <p className={cn("text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-2", !(isSidebarOpen || isMobileMenuOpen) && "hidden")}>Settings</p>
                  <SidebarItem to="/settings/business" icon={<Briefcase size={20} />} label="Business Profile" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                  <SidebarItem to="/settings/branches" icon={<Building2 size={20} />} label="Branches" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                  {userProfile?.role === 'admin' && (
                    <SidebarItem to="/settings/users" icon={<Users size={20} />} label="User Management" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                  )}
                  <SidebarItem to="/settings/currencies" icon={<Globe size={20} />} label="Currencies" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="pt-4 pb-2">
                <p className={cn("text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-2", !(isSidebarOpen || isMobileMenuOpen) && "hidden")}>Manager Portal</p>
                <SidebarItem to="/sales" icon={<ShoppingBag size={20} />} label="Sales / POS" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/tasks" icon={<CheckSquare size={20} />} label="Daily Tasks" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/vault" icon={<Shield size={20} />} label="Document Vault" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/payroll" icon={<DollarSign size={20} />} label="Payroll" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/cash-count" icon={<Calculator size={20} />} label="Cash Count" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/report" icon={<FileText size={20} />} label="Submit Report" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/reports" icon={<FileDown size={20} />} label="Business Reports" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
                <SidebarItem to="/suppliers" icon={<Package size={20} />} label="Suppliers" isOpen={isSidebarOpen} onClick={() => setIsMobileMenuOpen(false)} />
              </div>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={handleLogout}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all",
              !isSidebarOpen && "justify-center"
            )}
          >
            <LogOut size={20} />
            {isSidebarOpen && <span className="font-bold text-sm">Logout</span>}
          </button>
        </div>
      </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-[#0F172A] relative flex flex-col w-full">
          <header className="h-14 md:h-16 border-b border-slate-800 bg-[#1E293B]/50 backdrop-blur-xl flex items-center justify-between px-4 md:px-8 z-40 sticky top-0">
            <div className="flex items-center gap-3 md:gap-4">
              <button 
                onClick={() => setIsMobileMenuOpen(true)}
                className="p-2 hover:bg-slate-700 rounded-xl lg:hidden text-slate-400 cursor-pointer"
                title="Open Navigation Menu"
              >
                <Menu size={20} />
              </button>
              
              <div className="text-lg font-extrabold tracking-tight lg:hidden">
                SHOME<span className="text-blue-500">DESK</span>
              </div>

              {!isSidebarOpen && (
                <div className="text-xl font-extrabold tracking-tight hidden lg:block">
                  SHOME<span className="text-blue-500">DESK</span>
                </div>
              )}
              <div className="h-4 w-px bg-slate-800 hidden sm:block" />
              <div className="flex items-center gap-2 overflow-hidden">
                <p className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest hidden xs:block">Active:</p>
                <p className="text-[10px] md:text-xs font-black text-blue-400 truncate max-w-[100px] md:max-w-[200px]">
                  {isAllBusinessesSelected ? 'Global' : 
                    (selectedBranch ? selectedBranch.name : 
                      (selectedService ? selectedService.name : 
                        (selectedBusiness?.name || 'None')
                      )
                    )
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 md:gap-3">
              <PWAInstallButton />
              <NotificationCenter />
              <div className="h-6 md:h-8 w-px bg-slate-800" />
              <div className="flex items-center gap-2 md:gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-black text-slate-100 truncate max-w-[100px]">{userProfile?.displayName || 'User'}</p>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{userProfile?.role?.replace('_', ' ') || 'Guest'}</p>
                </div>
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-blue-600 flex items-center justify-center font-black text-white shadow-lg shadow-blue-900/20 text-xs md:text-base">
                  {userProfile?.displayName?.[0] || 'U'}
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-6xl mx-auto p-4 md:p-8">
              <Outlet />
            </div>
          </div>
          <BusinessAssistant />
        </main>
    </div>
  </div>
  );
}

function SidebarItem({ to, icon, label, isOpen, onClick }: { to: string; icon: React.ReactNode; label: string; isOpen: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={() => {
        if (window.innerWidth < 768 && onClick) {
          onClick();
        }
      }}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 p-2.5 md:p-3 rounded-xl transition-all duration-200 group",
          isActive 
            ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20" 
            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800",
          !isOpen && "md:justify-center"
        )
      }
    >
      <div className="shrink-0 scale-90 md:scale-100">{icon}</div>
      {(isOpen || window.innerWidth < 768) && <span className="font-bold text-xs md:text-sm tracking-tight">{label}</span>}
      {!isOpen && window.innerWidth >= 768 && (
        <div className="absolute left-20 bg-slate-800 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-[100]">
          {label}
        </div>
      )}
    </NavLink>
  );
}
