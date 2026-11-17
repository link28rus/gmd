import { apiFetch } from './client';

export interface PermissionState {
  status: 'unknown' | 'ok' | 'degraded' | 'stale';
  reportedAt: string | null;
  missing: Array<{ key: string; label: string }>;
}

export const permissionStateApi = {
  get: (id: string) => apiFetch<PermissionState>(`/api/children/${id}/permission-state`),
  refresh: (id: string) =>
    apiFetch<{ requested: boolean }>(`/api/children/${id}/refresh-permission-state`, {
      method: 'POST',
    }),
};
