// apps/web/lib/api/admin.ts
import { apiFetch } from './client';

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  users: { total: number; deleted: number };
  families: { total: number };
  children: { total: number; deleted: number };
  devices: { total: number; active: number; revoked: number };
  invites: { total: number; activeNow: number };
}

// ─── Users list ───────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  acceptedPrivacyPolicyVersion: string | null;
  createdAt: string;
  deletedAt: string | null;
  familyId: string | null;
  familyName: string | null;
  childrenCount: number;
}

export interface PaginatedUsers {
  items: UserRow[];
  page: number;
  limit: number;
  total: number;
}

// ─── User detail ──────────────────────────────────────────────────────────────

export interface UserDetail {
  user: {
    id: string;
    email: string;
    name: string | null;
    locale: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    acceptedPrivacyPolicyVersion: string | null;
  };
  memberships: Array<{ familyId: string; familyName: string; role: string }>;
  children: Array<{
    id: string;
    name: string;
    dateOfBirth: string | null;
    hasDevice: boolean;
    deviceLastSeenAt: string | null;
  }>;
  refreshTokensActive: number;
  otpCodesActiveLast24h: number;
}

// ─── Families ─────────────────────────────────────────────────────────────────

export interface FamilyRow {
  id: string;
  name: string;
  createdAt: string;
  membersCount: number;
  childrenCount: number;
  activeDevicesCount: number;
}

export interface PaginatedFamilies {
  items: FamilyRow[];
  page: number;
  limit: number;
  total: number;
}

// ─── Children ─────────────────────────────────────────────────────────────────

export interface AdminChildRow {
  id: string;
  name: string;
  dateOfBirth: string | null;
  familyId: string;
  familyName: string;
  deviceStatus: 'online' | 'offline' | 'revoked' | 'none';
  deviceLastSeenAt: string | null;
  deletedAt: string | null;
}

export interface PaginatedChildren {
  items: AdminChildRow[];
  page: number;
  limit: number;
  total: number;
}

// ─── Invites ──────────────────────────────────────────────────────────────────

export interface InviteRow {
  id: string;
  code: string;
  childId: string;
  childName: string;
  familyId: string;
  familyName: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
  createdByEmail: string;
}

export interface InviteList {
  items: InviteRow[];
}

// ─── API methods ──────────────────────────────────────────────────────────────

export const adminApi = {
  stats: () => apiFetch<AdminStats>('/api/admin/stats'),

  listUsers: ({ page = 1, limit = 50, q = '' }: { page?: number; limit?: number; q?: string }) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(q ? { q } : {}),
    });
    return apiFetch<PaginatedUsers>(`/api/admin/users?${params.toString()}`);
  },

  getUserDetail: (id: string) => apiFetch<UserDetail>(`/api/admin/users/${id}`),

  listFamilies: ({ page = 1, limit = 50 }: { page?: number; limit?: number } = {}) =>
    apiFetch<PaginatedFamilies>(
      `/api/admin/families?${new URLSearchParams({ page: String(page), limit: String(limit) }).toString()}`,
    ),

  listChildren: ({ page = 1, limit = 50 }: { page?: number; limit?: number } = {}) =>
    apiFetch<PaginatedChildren>(
      `/api/admin/children?${new URLSearchParams({ page: String(page), limit: String(limit) }).toString()}`,
    ),

  listActiveInvites: () => apiFetch<InviteList>('/api/admin/invites?active=true'),

  listSettings: () => apiFetch<{ settings: AppSettingRow[] }>('/api/admin/settings'),

  updateSetting: (key: string, value: string) =>
    apiFetch<{ ok: true }>(`/api/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
      headers: { 'content-type': 'application/json' },
    }),
};

export interface AppSettingRow {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
