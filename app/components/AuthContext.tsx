'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

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
// The owner's email is NOT hardcoded here (it must not ship in the client
// bundle — SEC-C1); it is fetched from /api/auth/me, which reads OWNER_EMAIL
// server-side. Until that resolves, the email is blank.
const SOLO_USER: AuthUser = { userId: 'solo', email: '' };

export const AuthContext = createContext<AuthContextValue>({
  user: SOLO_USER,
  loading: false,
  setUser: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(SOLO_USER);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthUser | null) => {
        if (!cancelled && data) setUser(data);
      })
      .catch(() => {
        // Non-blocking — the app works without the owner email.
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading: false, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
