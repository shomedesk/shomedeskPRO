import React, { useState, useEffect } from 'react';
import { db } from '@/src/lib/firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { Task } from '@/src/types';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { toast } from 'sonner';
import { 
  CheckSquare, 
  Plus, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  Trash2, 
  Calendar,
  Filter
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { format } from 'date-fns';

export default function Tasks() {
  const { selectedBusiness, selectedBranch, businesses, branches, isAllBusinessesSelected, userProfile } = useBusiness();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'manager';

  useEffect(() => {
    if (!selectedBusiness && !isAllBusinessesSelected) return;

    let unsub: () => void = () => {};

    if (isAllBusinessesSelected) {
      const businessIds = businesses.map(b => b.id);
      if (businessIds.length === 0) {
        setTasks([]);
        setLoading(false);
        return;
      }

      const q = query(
        collection(db, 'tasks'),
        where('businessId', 'in', businessIds.slice(0, 10))
      );

      unsub = onSnapshot(q, (snapshot) => {
        const taskList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task));
        setTasks(taskList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'tasks');
      });
    } else {
      let q = query(
        collection(db, 'tasks'),
        where('businessId', '==', selectedBusiness!.id)
      );

      if (selectedBranch) {
        q = query(
          collection(db, 'tasks'),
          where('businessId', '==', selectedBusiness!.id),
          where('branchId', '==', selectedBranch.id)
        );
      }

      unsub = onSnapshot(q, (snapshot) => {
        const taskList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Task));
        setTasks(taskList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'tasks');
      });
    }

    return () => unsub();
  }, [selectedBusiness, selectedBranch, isAllBusinessesSelected, businesses]);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBusiness || !selectedBranch) return;

    const form = e.target as HTMLFormElement;
    const description = (form.elements.namedItem('description') as HTMLInputElement).value;
    const priority = (form.elements.namedItem('priority') as HTMLSelectElement).value as any;
    const deadline = (form.elements.namedItem('deadline') as HTMLInputElement).value;

    try {
      await addDoc(collection(db, 'tasks'), {
        businessId: selectedBusiness.id,
        ownerId: selectedBusiness.ownerId,
        branchId: selectedBranch.id,
        description,
        priority,
        deadline,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      toast.success('Task assigned to branch');
      setIsModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
      toast.error('Failed to add task');
    }
  };

  const toggleTaskStatus = async (task: Task) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        status: task.status === 'pending' ? 'completed' : 'pending'
      });
      toast.success('Task status updated');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `tasks/${task.id}`);
      toast.error('Failed to update task');
    }
  };

  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const deleteTask = (id: string) => {
    setConfirmAction({
      title: 'Delete Task',
      message: 'Are you sure you want to delete this task? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'tasks', id));
          toast.success('Task deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `tasks/${id}`);
          toast.error('Failed to delete task');
        }
      }
    });
    setIsConfirmModalOpen(true);
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div className="space-y-1">
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-3">
            <CheckSquare className="text-blue-500" size={28} />
            Daily Tasks
          </h2>
          <p className="text-slate-400 font-bold text-sm uppercase tracking-widest">
            {isAllBusinessesSelected ? 'Tasks across all your businesses' : (isAdmin ? `Assign tasks to ${selectedBranch?.name || 'Branch'}` : 'Your daily branch operations')}
          </p>
        </div>
        {isAdmin && userProfile?.role !== 'accountant' && (
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-6 rounded-2xl flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
          >
            <Plus size={20} />
            Assign Task
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          label="Pending" 
          value={tasks.filter(t => t.status === 'pending').length} 
          icon={<Clock className="text-amber-400" />} 
          color="border-amber-500/20"
        />
        <StatCard 
          label="Completed" 
          value={tasks.filter(t => t.status === 'completed').length} 
          icon={<CheckCircle2 className="text-emerald-400" />} 
          color="border-emerald-500/20"
        />
        <StatCard 
          label="Total" 
          value={tasks.length} 
          icon={<Filter className="text-blue-400" />} 
          color="border-blue-500/20"
        />
      </div>

      <div className="bg-[#1E293B] rounded-[2.5rem] border border-slate-800 shadow-xl overflow-hidden">
        <div className="divide-y divide-slate-800">
          {tasks.map((task) => (
            <div key={task.id} className="p-6 flex items-center justify-between hover:bg-slate-800/50 transition-colors group">
              <div className="flex items-center gap-6 flex-1">
                <button 
                  onClick={() => {
                    if (userProfile?.role === 'accountant') return;
                    toggleTaskStatus(task);
                  }}
                  disabled={userProfile?.role === 'accountant'}
                  className={cn(
                    "w-8 h-8 rounded-xl border-2 flex items-center justify-center transition-all",
                    task.status === 'completed' 
                      ? "bg-emerald-500 border-emerald-500 text-white" 
                      : "border-slate-700 text-transparent hover:border-blue-500",
                    userProfile?.role === 'accountant' && "cursor-default opacity-50"
                  )}
                >
                  <CheckCircle2 size={18} />
                </button>
                <div className="space-y-1">
                  <p className={cn(
                    "font-bold text-slate-200 transition-all",
                    task.status === 'completed' && "line-through text-slate-500"
                  )}>
                    {task.description}
                  </p>
                  <div className="flex items-center gap-4">
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md",
                      task.priority === 'high' ? "bg-rose-500/10 text-rose-400" :
                      task.priority === 'medium' ? "bg-amber-500/10 text-amber-400" :
                      "bg-blue-500/10 text-blue-400"
                    )}>
                      {task.priority} Priority
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                      <Calendar size={12} />
                      Due: {task.deadline}
                    </span>
                    {!selectedBranch && (
                      <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest px-2 py-0.5 bg-blue-500/10 rounded-md">
                        {branches.find(b => b.id === task.branchId)?.name || 'Branch'}
                      </span>
                    )}
                    {isAllBusinessesSelected && (
                      <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest px-2 py-0.5 bg-amber-500/10 rounded-md">
                        {businesses.find(b => b.id === task.businessId)?.name || 'Business'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {isAdmin && userProfile?.role !== 'accountant' && (
                <button 
                  onClick={() => deleteTask(task.id)}
                  className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
          {tasks.length === 0 && !loading && (
            <div className="p-20 text-center space-y-4">
              <div className="bg-slate-900 w-16 h-16 rounded-3xl flex items-center justify-center mx-auto border border-slate-800">
                <CheckSquare size={32} className="text-slate-700" />
              </div>
              <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No tasks found for this branch</p>
            </div>
          )}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1E293B] w-full max-w-md max-h-[90vh] rounded-[2.5rem] border border-slate-800 shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center flex-shrink-0">
              <h2 className="text-lg font-black uppercase tracking-widest">Assign New Task</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <AlertCircle size={20} />
              </button>
            </div>
            <form onSubmit={handleAddTask} className="p-6 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Task Description</label>
                <textarea
                  name="description"
                  required
                  maxLength={10000}
                  className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500 h-24 resize-none"
                  placeholder="What needs to be done?"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Priority</label>
                  <select
                    name="priority"
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500 appearance-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Deadline</label>
                  <input
                    name="deadline"
                    type="date"
                    required
                    className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20"
              >
                <Plus size={20} />
                Assign Task
              </button>
            </form>
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

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className={cn("bg-[#1E293B] p-6 rounded-3xl border shadow-xl flex items-center gap-4", color)}>
      <div className="bg-slate-900 p-3 rounded-2xl">{icon}</div>
      <div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</p>
        <p className="text-2xl font-black text-slate-200">{value}</p>
      </div>
    </div>
  );
}
