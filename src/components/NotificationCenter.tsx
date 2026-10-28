import React, { useState, useEffect } from 'react';
import { Bell, Check, Clock, AlertTriangle, X, DollarSign, Calendar, FileText } from 'lucide-react';
import { db, auth } from '@/src/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, limit, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { cn } from '@/src/lib/utils';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { handleFirestoreError, OperationType } from '@/src/lib/firestore-utils';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  businessId: string;
  userId?: string;
  title: string;
  message: string;
  type: 'salary_request' | 'leave_request' | 'document_renewal' | 'system';
  status: 'unread' | 'read';
  link?: string;
  createdAt: any;
}

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { selectedBusiness, userProfile } = useBusiness();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!selectedBusiness || !userProfile) return;

    // Admins see all business notifications, others see their specific ones
    const q = userProfile.role === 'admin' 
      ? query(
          collection(db, 'notifications'),
          where('businessId', '==', selectedBusiness.id),
          orderBy('createdAt', 'desc'),
          limit(20)
        )
      : query(
          collection(db, 'notifications'),
          where('businessId', '==', selectedBusiness.id),
          where('userId', '==', userProfile.uid),
          orderBy('createdAt', 'desc'),
          limit(20)
        );

    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Notification));
      setNotifications(list);
      setUnreadCount(list.filter(n => n.status === 'unread').length);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'notifications');
    });

    return () => unsub();
  }, [selectedBusiness, userProfile]);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { status: 'read' });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unread = notifications.filter(n => n.status === 'unread');
      await Promise.all(unread.map(n => updateDoc(doc(db, 'notifications', n.id), { status: 'read' })));
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  const deleteNotification = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notifications', id));
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'salary_request': return <DollarSign className="text-emerald-400" size={16} />;
      case 'leave_request': return <Calendar className="text-amber-400" size={16} />;
      case 'document_renewal': return <AlertTriangle className="text-red-400" size={16} />;
      default: return <FileText className="text-blue-400" size={16} />;
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-[#0F172A]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div 
            className="fixed inset-0 z-[60]" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] sm:w-80 bg-[#1E293B] border border-slate-800 rounded-2xl shadow-2xl z-[70] overflow-hidden flex flex-col max-h-[500px]">
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Notifications</h3>
              {unreadCount > 0 && (
                <button 
                  onClick={markAllAsRead}
                  className="text-[10px] font-black text-blue-500 hover:text-blue-400 uppercase tracking-widest"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center space-y-2 opacity-50">
                  <Bell size={32} className="mx-auto text-slate-700" />
                  <p className="text-xs font-bold text-slate-500">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {notifications.map((n) => (
                    <div 
                      key={n.id}
                      className={cn(
                        "p-4 hover:bg-slate-800/50 transition-colors group relative",
                        n.status === 'unread' && "bg-blue-500/5"
                      )}
                    >
                      <div className="flex gap-3">
                        <div className={cn(
                          "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
                          n.status === 'unread' ? "bg-slate-800" : "bg-slate-900/50"
                        )}>
                          {getIcon(n.type)}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn(
                              "text-xs font-bold truncate",
                              n.status === 'unread' ? "text-slate-100" : "text-slate-400"
                            )}>
                              {n.title}
                            </p>
                            <button 
                              onClick={() => deleteNotification(n.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700 rounded transition-all text-slate-500"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                            {n.message}
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <Clock size={10} className="text-slate-600" />
                            <span className="text-[9px] font-bold text-slate-600 uppercase">
                              {n.createdAt?.toDate ? formatDistanceToNow(n.createdAt.toDate(), { addSuffix: true }) : 'just now'}
                            </span>
                            {n.status === 'unread' && (
                              <button 
                                onClick={() => markAsRead(n.id)}
                                className="ml-auto text-[9px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-1"
                              >
                                <Check size={10} />
                                Mark read
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 bg-slate-900/50 border-t border-slate-800 text-center">
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                End of notifications
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
