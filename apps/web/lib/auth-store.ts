'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  isAdmin?: boolean;
  hasPassword?: boolean;
  hasPin?: boolean;
}

interface AuthUserPatch {
  hasPassword?: boolean;
  hasPin?: boolean;
  name?: string | null;
  locale?: string;
}

export interface AuthFamily {
  id: string;
  name: string;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  family: AuthFamily | null;
  requiresConsent: boolean;
  setAll: (s: { accessToken: string; user: AuthUser; family: AuthFamily }) => void;
  setAccess: (t: string) => void;
  setConsent: (requiresConsent: boolean) => void;
  patchUser: (patch: AuthUserPatch) => void;
  clear: () => void;
}

/**
 * Auth state хранится в localStorage `gmd-auth`, чтобы пережить page reload.
 * accessToken (15м TTL) при истечении обновляется через `/api/auth/refresh`
 * (refresh-token в HTTP-only cookie). Без persist каждый F5 разлогинивал.
 *
 * `requiresConsent` — серверное состояние, не персистим (запросим заново).
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      family: null,
      requiresConsent: false,
      setAll: ({ accessToken, user, family }) => set({ accessToken, user, family }),
      setAccess: (accessToken) => set({ accessToken }),
      setConsent: (requiresConsent) => set({ requiresConsent }),
      patchUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
      clear: () => set({ accessToken: null, user: null, family: null, requiresConsent: false }),
    }),
    {
      name: 'gmd-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accessToken: s.accessToken,
        user: s.user,
        family: s.family,
      }),
    },
  ),
);
