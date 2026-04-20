'use client';

import React, { createContext, useContext, useState } from 'react';

export interface AuthUser {
  userId: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
}

// Auth is disabled — single-user mode. All pages are accessible without login.
const SOLO_USER: AuthUser = { userId: 'solo', email: 'kcwalr13@gmail.com' };

export const AuthContext = createContext<AuthContextValue>({
  user: SOLO_USER,
  loading: false,
  setUser: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user] = useState<AuthUser>(SOLO_USER);

  return (
    <AuthContext.Provider value={{ user, loading: false, setUser: () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}
