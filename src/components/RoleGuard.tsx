import React from 'react';
import { Navigate } from 'react-router-dom';
import { useBusiness } from '@/src/contexts/BusinessContext';
import { UserProfile } from '@/src/types';
import { auth } from '@/src/lib/firebase';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserProfile['role'][];
}

export default function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
  const { userProfile, loading } = useBusiness();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!userProfile) {
    // If authenticated but no profile, allow access to settings to avoid deadlocks
    if (auth.currentUser) return <>{children}</>;
    return <Navigate to="/" replace />;
  }

  if (!allowedRoles.includes(userProfile.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
