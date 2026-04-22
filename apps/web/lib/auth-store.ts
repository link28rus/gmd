'use client';

import { create } from 'zustand';

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

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  family: null,
  requiresConsent: false,
  setAll: ({ accessToken, user, family }) => set({ accessToken, user, family }),
  setAccess: (accessToken) => set({ accessToken }),
  setConsent: (requiresConsent) => set({ requiresConsent }),
  patchUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
  clear: () => set({ accessToken: null, user: null, family: null, requiresConsent: false }),
}));
