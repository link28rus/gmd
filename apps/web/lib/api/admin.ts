// apps/web/lib/api/admin.ts
import { apiFetch } from './client';

// ─── Sorting ────────────────────────────────────────────────────────────────
export type SortDir = 'asc' | 'desc';
export type UserSortField = 'createdAt' | 'email' | 'name' | 'lastSeenAt' | 'role';
export type FamilySortField = 'createdAt' | 'name' | 'deletedAt';
export type ChildSortField = 'createdAt' | 'name' | 'dateOfBirth' | 'deletedAt';

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface AdminStats {
  users: { total: number; deleted: number };
  families: { total: number };
  children: { total: number; deleted: number };
  devices: { total: number; active: number; revoked: number };
  invites: { total: number; activeNow: number };
}

// ─── Users list ───────────────────────────────────────────────────────────────

export type UserAdminRole = 'admin' | 'parent';

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  role: UserAdminRole;
  blockedAt: string | null;
  blockedReason: string | null;
  lastSeenAt: string | null;
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
  deletedAt: string | null;
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
  maxUses: number;
  usesCount: number;
  createdAt: string;
  createdByEmail: string | null;
}

export interface PaginatedInvites {
  items: InviteRow[];
  page: number;
  limit: number;
  total: number;
}

// ─── Diag logs (журнал приложения ребёнка, v0.60.0) ───────────────────────────
// Контракт: docs/superpowers/specs/2026-09-29-child-diag-logs.md, раздел «Администратор».

export type DiagCategory =
  | 'audio'
  | 'location'
  | 'realtime'
  | 'push'
  | 'update'
  | 'system'
  | 'other';

export const DIAG_CATEGORIES: readonly DiagCategory[] = [
  'audio',
  'location',
  'realtime',
  'push',
  'update',
  'system',
  'other',
];

export interface DiagConfig {
  /** Какие категории попадают в отправляемый журнал. */
  send: DiagCategory[];
  /** Для каких категорий писать подробные (DEBUG) записи. */
  debug: DiagCategory[];
  /** ISO-время, после которого подробный режим сам выключается; null = бессрочно. */
  debugUntil: string | null;
  /** Прикладывать системный logcat своего процесса. */
  logcat: boolean;
  /** Прикладывать снимок состояния телефона. */
  snapshot: boolean;
  /** Сам отправлять журнал при сбоях. */
  autoUpload: boolean;
}

export const DEFAULT_DIAG_CONFIG: DiagConfig = {
  send: [...DIAG_CATEGORIES],
  debug: [],
  debugUntil: null,
  logcat: false,
  snapshot: true,
  autoUpload: true,
};

export interface DiagUploadRow {
  id: string;
  reason: 'manual' | 'auto';
  trigger: string | null;
  appVersion: string | null;
  sizeBytes: number;
  createdAt: string;
}

export interface DiagUploadDetail extends DiagUploadRow {
  childId: string;
  commandId: string | null;
  snapshot: string | null;
  log: string | null;
  logcat: string | null;
}

export interface AdminChildDiag {
  device: {
    id: string;
    appVersion: string | null;
    lastSeenAt: string | null;
    online: boolean;
  } | null;
  config: DiagConfig;
  pendingRequest: { commandId: string; createdAt: string; expiresAt: string } | null;
  uploads: DiagUploadRow[];
}

// ─── API methods ──────────────────────────────────────────────────────────────

export const adminApi = {
  stats: () => apiFetch<AdminStats>('/api/admin/stats'),

  listUsers: ({
    page = 1,
    limit = 50,
    q = '',
    showDeleted = false,
    sortBy,
    sortDir,
  }: {
    page?: number;
    limit?: number;
    q?: string;
    showDeleted?: boolean;
    sortBy?: UserSortField;
    sortDir?: SortDir;
  }) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) params.set('q', q);
    if (showDeleted) params.set('showDeleted', 'true');
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDir) params.set('sortDir', sortDir);
    return apiFetch<PaginatedUsers>(`/api/admin/users?${params.toString()}`);
  },

  getUserDetail: (id: string) => apiFetch<UserDetail>(`/api/admin/users/${id}`),

  restoreUser: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}/restore`, { method: 'POST' }),

  listFamilies: ({
    page = 1,
    limit = 50,
    q = '',
    showDeleted = false,
    sortBy,
    sortDir,
  }: {
    page?: number;
    limit?: number;
    q?: string;
    showDeleted?: boolean;
    sortBy?: FamilySortField;
    sortDir?: SortDir;
  } = {}) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) params.set('q', q);
    if (showDeleted) params.set('showDeleted', 'true');
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDir) params.set('sortDir', sortDir);
    return apiFetch<PaginatedFamilies>(`/api/admin/families?${params.toString()}`);
  },

  deleteFamily: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/families/${id}`, { method: 'DELETE' }),

  restoreFamily: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/families/${id}/restore`, { method: 'POST' }),

  listChildren: ({
    page = 1,
    limit = 50,
    q = '',
    showDeleted = false,
    sortBy,
    sortDir,
  }: {
    page?: number;
    limit?: number;
    q?: string;
    showDeleted?: boolean;
    sortBy?: ChildSortField;
    sortDir?: SortDir;
  } = {}) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) params.set('q', q);
    if (showDeleted) params.set('showDeleted', 'true');
    if (sortBy) params.set('sortBy', sortBy);
    if (sortDir) params.set('sortDir', sortDir);
    return apiFetch<PaginatedChildren>(`/api/admin/children?${params.toString()}`);
  },

  deleteChild: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/children/${id}`, { method: 'DELETE' }),

  restoreChild: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/children/${id}/restore`, { method: 'POST' }),

  resetChildDevice: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/children/${id}/reset-device`, { method: 'POST' }),

  getChildDiag: (childId: string) =>
    apiFetch<AdminChildDiag>(`/api/admin/children/${encodeURIComponent(childId)}/diag`),

  updateChildDiagConfig: (childId: string, config: DiagConfig) =>
    apiFetch<{ config: DiagConfig; delivered: boolean }>(
      `/api/admin/children/${encodeURIComponent(childId)}/diag/config`,
      {
        method: 'PATCH',
        body: JSON.stringify(config),
        headers: { 'content-type': 'application/json' },
      },
    ),

  requestChildDiag: (childId: string) =>
    apiFetch<{ commandId: string; delivered: boolean; expiresAt: string }>(
      `/api/admin/children/${encodeURIComponent(childId)}/diag/request`,
      { method: 'POST' },
    ),

  getDiagUpload: (uploadId: string) =>
    apiFetch<DiagUploadDetail>(`/api/admin/diag/uploads/${encodeURIComponent(uploadId)}`),

  deleteDiagUpload: (uploadId: string) =>
    apiFetch<{ ok: true }>(`/api/admin/diag/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
    }),

  listInvites: ({
    page = 1,
    limit = 50,
    q = '',
  }: { page?: number; limit?: number; q?: string } = {}) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) params.set('q', q);
    return apiFetch<PaginatedInvites>(`/api/admin/invites?${params.toString()}`);
  },

  revokeInvite: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/invites/${id}`, { method: 'DELETE' }),

  listSettings: () => apiFetch<{ settings: AppSettingRow[] }>('/api/admin/settings'),

  updateSetting: (key: string, value: string) =>
    apiFetch<{ ok: true }>(`/api/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
      headers: { 'content-type': 'application/json' },
    }),

  smtpTest: (to: string) =>
    apiFetch<{ ok: boolean; messageId?: string; error?: string }>(`/api/admin/smtp/test`, {
      method: 'POST',
      body: JSON.stringify({ to }),
      headers: { 'content-type': 'application/json' },
    }),

  setUserRole: (id: string, role: UserAdminRole) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
      headers: { 'content-type': 'application/json' },
    }),

  blockUser: (id: string, reason?: string) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}/block`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? undefined }),
      headers: { 'content-type': 'application/json' },
    }),

  unblockUser: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}/unblock`, { method: 'POST' }),

  resetUserPassword: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}/reset-password`, { method: 'POST' }),

  deleteUser: (id: string) =>
    apiFetch<{ ok: true }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
};

export interface AppSettingRow {
  key: string;
  /** null для секретных ключей — фактическое значение админу не возвращается. */
  value: string | null;
  description: string | null;
  isSecret: boolean;
  /** true если в БД лежит непустое значение (полезно для секретов). */
  hasValue: boolean;
  updatedAt: string;
  updatedBy: string | null;
}
