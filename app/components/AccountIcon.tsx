'use client';

import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function AccountIcon() {
  const { user, loading, setUser } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    setMenuOpen(false);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // swallow — cookie will expire naturally
    }
    setUser(null);
  }

  const iconClass = `w-[18px] h-[18px]`;

  const outlineIcon = (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );

  const filledIcon = (
    <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
    </svg>
  );

  if (loading) {
    return (
      <button
        className="p-3 text-gray-400 opacity-50"
        aria-label="Sign in"
        disabled
      >
        {outlineIcon}
      </button>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="p-3 text-gray-900 hover:text-gray-600 transition-colors"
        aria-label="Account menu"
        aria-expanded={menuOpen}
      >
        {filledIcon}
      </button>

      {menuOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
            <p className="px-3 py-2 text-xs text-gray-400 truncate">{user.email}</p>
            <hr className="border-gray-100" />
            <button
              onClick={handleLogout}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors min-h-[44px]"
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
