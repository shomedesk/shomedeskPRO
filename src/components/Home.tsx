import React, { useState, useEffect } from 'react';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { currencyService } from '@/src/services/currencyService';
import { 
  Building2, 
  MapPin, 
  Phone, 
  User, 
  PlusCircle, 
  FileText, 
  ArrowRightLeft,
  TrendingUp,
  Briefcase,
  Package,
  CheckSquare,
  AlertTriangle,
  Globe,
  Wallet,
  Landmark
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/src/lib/utils';

export default function Home() {
  const { selectedBusiness, isAllBusinessesSelected, businesses, branches, bankAccounts, selectedBranch, userProfile } = useBusiness();
  const isBranchManager = userProfile?.role === 'branch_manager';
  const [totalInrBalance, setTotalInrBalance] = useState<number>(0);

  useEffect(() => {
    if (isAllBusinessesSelected) {
      const calculateTotal = async () => {
        let total = 0;
        for (const ba of bankAccounts) {
          const business = businesses.find(b => b.id === ba.businessId);
          const inr = await currencyService.convertToINR(ba.balance, business?.currency || 'INR');
          total += inr;
        }
        setTotalInrBalance(total);
      };
      calculateTotal();
    }
  }, [isAllBusinessesSelected, bankAccounts, businesses]);

  if (!selectedBusiness && !isAllBusinessesSelected) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] space-y-6 md:space-y-8 text-center px-4">
        <div className="relative">
          <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full animate-pulse"></div>
          <div className="bg-slate-800 p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-slate-700 relative shadow-2xl">
            <Briefcase size={48} className="md:w-16 md:h-16 text-blue-500" />
          </div>
        </div>
        
        <div className="space-y-2 md:space-y-3">
          <h2 className="text-2xl md:text-4xl font-black uppercase tracking-tighter text-slate-50">No Business Selected</h2>
          <p className="text-[10px] md:text-sm text-slate-400 font-medium max-w-md mx-auto leading-relaxed">
            Welcome to ShomeDesk! To start managing your operations, you need to create your first business profile or select one from the sidebar.
          </p>
        </div>

        {!isBranchManager ? (
          <div className="flex flex-col gap-4 md:gap-6 w-full max-w-sm">
            <Link 
              to="/settings"
              className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 md:py-6 px-6 md:px-10 rounded-2xl md:rounded-[2rem] transition-all active:scale-95 shadow-2xl shadow-blue-900/40 uppercase tracking-widest text-sm md:text-base flex items-center justify-center gap-2 md:gap-3 border-b-4 border-blue-800"
            >
              <PlusCircle size={20} className="md:w-6 md:h-6" />
              Create Your Business
            </Link>
            
            <div className="space-y-1.5 md:space-y-2">
              <p className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">
                Need help?
              </p>
              <p className="text-[10px] md:text-xs text-slate-400">
                Go to <span className="text-blue-400 font-bold">Settings</span> in the sidebar to manage your business, branches, and team.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800/50 p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] border border-slate-700 max-w-sm shadow-xl">
            <div className="bg-amber-500/10 w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center mx-auto mb-3 md:mb-4 border border-amber-500/20">
              <AlertTriangle className="text-amber-500 w-5 h-5 md:w-6 md:h-6" />
            </div>
            <p className="text-slate-300 font-bold text-[10px] md:text-sm leading-relaxed">
              It seems you don't have an assigned business. Please contact your administrator to link your account to a business.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (isAllBusinessesSelected) {
    return (
      <div className="space-y-6 md:space-y-8">
        <div className="relative overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 p-6 md:p-8 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl border border-white/5">
          <div className="relative z-10 space-y-4 md:space-y-6">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-blue-400 font-black text-[9px] md:text-[10px] uppercase tracking-[0.3em]">Global Overview</p>
                <h1 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase">All Businesses</h1>
              </div>
              <div className="bg-blue-600/20 p-2.5 md:p-3 rounded-xl md:rounded-2xl border border-blue-500/20">
                <Globe className="text-blue-500 w-5 h-5 md:w-6 md:h-6" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
              <InfoCard icon={<Briefcase size={14} className="md:w-4 md:h-4" />} label="Total Businesses" value={businesses.length.toString()} />
              <InfoCard icon={<Building2 size={14} className="md:w-4 md:h-4" />} label="Total Branches" value={branches.length.toString()} />
              <InfoCard icon={<Landmark size={14} className="md:w-4 md:h-4" />} label="Total Balance (INR)" value={currencyService.formatCurrency(totalInrBalance, 'INR')} />
            </div>
          </div>
          <div className="absolute -right-20 -top-20 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl"></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {businesses.map(business => (
            <div key={business.id} className="bg-[#1E293B] p-5 md:p-6 rounded-2xl md:rounded-[2rem] border border-slate-800 shadow-xl space-y-3 md:space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-slate-50 uppercase tracking-tight text-sm md:text-base truncate">{business.name}</h3>
                <span className="bg-blue-600/20 text-blue-400 text-[9px] md:text-[10px] font-black px-2 py-0.5 md:py-1 rounded-lg uppercase">{business.currency}</span>
              </div>
              <div className="space-y-1.5 md:space-y-2">
                <div className="flex justify-between text-[10px] md:text-xs">
                  <span className="text-slate-500 font-bold uppercase">Branches</span>
                  <span className="text-slate-300 font-black">{branches.filter(br => br.businessId === business.id).length}</span>
                </div>
                <div className="flex justify-between text-[10px] md:text-xs">
                  <span className="text-slate-500 font-bold uppercase">Accounts</span>
                  <span className="text-slate-300 font-black">{bankAccounts.filter(ba => ba.businessId === business.id).length}</span>
                </div>
              </div>
              <button 
                onClick={() => {}} // This would ideally select the business
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 rounded-xl text-[10px] md:text-xs transition-all"
              >
                View Details
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 p-6 md:p-8 rounded-2xl md:rounded-[2.5rem] shadow-2xl shadow-blue-900/20 border border-white/10">
        <div className="relative z-10 space-y-4 md:space-y-6">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <p className="text-blue-100 font-black text-[9px] md:text-[10px] uppercase tracking-[0.3em]">
                {isBranchManager ? 'Branch Manager Portal' : 'Welcome to'}
              </p>
              <h1 className="text-2xl md:text-4xl font-black text-white tracking-tighter uppercase truncate max-w-[200px] md:max-w-none">{selectedBusiness.name}</h1>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-2.5 md:p-3 rounded-xl md:rounded-2xl border border-white/10">
              <TrendingUp className="text-white w-5 h-5 md:w-6 md:h-6" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
            <InfoCard icon={<MapPin size={14} className="md:w-4 md:h-4" />} label="Branch" value={selectedBranch?.name || 'No Branch'} />
            <InfoCard icon={<Phone size={14} className="md:w-4 md:h-4" />} label="Contact" value={selectedBusiness.mobileNumber || 'Not set'} />
            <InfoCard icon={<User size={14} className="md:w-4 md:h-4" />} label="Manager" value={selectedBranch?.managerName || 'Not set'} />
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
        <div className="absolute -left-20 -bottom-20 w-64 h-64 bg-blue-400/20 rounded-full blur-3xl"></div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-3 md:space-y-4">
        <h3 className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] ml-2">Quick Actions</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {isBranchManager ? (
            <>
              <ActionCard 
                to="/tasks" 
                icon={<CheckSquare className="text-blue-400" />} 
                title="Daily Tasks" 
                desc="View assigned tasks" 
                color="hover:border-blue-500/50"
              />
              <ActionCard 
                to="/report" 
                icon={<FileText className="text-emerald-400" />} 
                title="Submit Report" 
                desc="Log branch summary" 
                color="hover:border-emerald-500/50"
              />
              <ActionCard 
                to="/suppliers" 
                icon={<Package className="text-purple-400" />} 
                title="Suppliers" 
                desc="Manage branch bills" 
                color="hover:border-purple-500/50"
              />
            </>
          ) : (
            <>
              <ActionCard 
                to="/report" 
                icon={<FileText className="text-emerald-400" />} 
                title="Daily Report" 
                desc="Log today's summary" 
                color="hover:border-emerald-500/50"
              />
              <ActionCard 
                to="/finance/cash" 
                icon={<PlusCircle className="text-blue-400" />} 
                title="New Income" 
                desc="Record cash entry" 
                color="hover:border-blue-500/50"
              />
              <ActionCard 
                to="/finance/bank" 
                icon={<ArrowRightLeft className="text-amber-400" />} 
                title="Transfer" 
                desc="Move funds to bank" 
                color="hover:border-amber-500/50"
              />
              <ActionCard 
                to="/suppliers" 
                icon={<Package className="text-purple-400" />} 
                title="Purchase" 
                desc="Log supplier bill" 
                color="hover:border-purple-500/50"
              />
            </>
          )}
        </div>
      </div>

      {/* Business Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#1E293B] p-6 rounded-[2rem] border border-slate-800 shadow-xl space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <Building2 size={16} className="text-blue-500" />
            Business Details
          </h3>
          <div className="space-y-3">
            <DetailItem label="Currency" value={selectedBusiness.currency} />
            <DetailItem label="Mobile" value={selectedBusiness.mobileNumber || 'N/A'} />
            <DetailItem label="Status" value="Active" />
          </div>
        </div>

        <div className="bg-[#1E293B] p-6 rounded-[2rem] border border-slate-800 shadow-xl space-y-4">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <MapPin size={16} className="text-emerald-500" />
            Branch Info
          </h3>
          <div className="space-y-3">
            <DetailItem label="Location" value={selectedBranch?.location || 'N/A'} />
            <DetailItem label="Manager" value={selectedBranch?.managerName || 'N/A'} />
            <DetailItem label="Branch Mobile" value={selectedBranch?.mobileNumber || 'N/A'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 flex items-center gap-3">
      <div className="text-blue-200">{icon}</div>
      <div>
        <p className="text-[9px] font-black text-blue-200 uppercase tracking-widest leading-none mb-1">{label}</p>
        <p className="text-sm font-bold text-white truncate">{value}</p>
      </div>
    </div>
  );
}

function ActionCard({ to, icon, title, desc, color }: { to: string; icon: React.ReactNode; title: string; desc: string; color: string }) {
  return (
    <Link 
      to={to} 
      className={cn(
        "bg-[#1E293B] p-4 md:p-6 rounded-2xl md:rounded-3xl border border-slate-800 shadow-xl transition-all hover:-translate-y-1 active:scale-95 group",
        color
      )}
    >
      <div className="space-y-3 md:space-y-4">
        <div className="bg-slate-900 w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center border border-slate-800 group-hover:scale-110 transition-transform">
          {icon}
        </div>
        <div className="space-y-1">
          <h4 className="font-black text-xs md:text-sm uppercase tracking-tight truncate">{title}</h4>
          <p className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center p-2.5 md:p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
      <span className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
      <span className="text-xs md:text-sm font-bold text-slate-200 truncate ml-2">{value}</span>
    </div>
  );
}
