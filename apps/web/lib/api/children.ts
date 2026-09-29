// apps/web/lib/api/children.ts
import { apiFetch, apiFetchBlob } from './client';

export interface ChildDevice {
  id: string;
  deviceName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface Child {
  id: string;
  name: string;
  dateOfBirth: string | null;
  protectionEnabled: boolean;
  protectionEnabledAt: string | null;
  /** `null` — буква имени, `preset:<id>` — стандартный аватар, `photo:<version>` — своё фото. */
  avatarKey: string | null;
  device: ChildDevice | null;
}

export interface ProtectionState {
  enabled: boolean;
  enabledAt: string | null;
  enabledBy: string | null;
}

export interface InviteResponse {
  code: string;
  qrUrl: string;
  deepLink: string;
  expiresIn: number;
}

export interface CreateChildInput {
  name: string;
  dateOfBirth?: string;
}

export interface UpdateChildInput {
  name?: string;
  dateOfBirth?: string | null;
}

export type SetAvatarInput =
  | { preset: string }
  | { photo: { mime: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string } };

export const childrenApi = {
  list: () => apiFetch<{ children: Child[] }>('/api/children'),
  create: (body: CreateChildInput) =>
    apiFetch<{ child: Child }>('/api/children', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: UpdateChildInput) =>
    apiFetch<{ child: Child }>(`/api/children/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) => apiFetch<void>(`/api/children/${id}`, { method: 'DELETE' }),
  createInvite: (id: string, opts: { consent14PlusGranted?: boolean } = {}) =>
    apiFetch<InviteResponse>(`/api/children/${id}/invites`, {
      method: 'POST',
      body: JSON.stringify({ consent14PlusGranted: opts.consent14PlusGranted === true }),
      headers: { 'content-type': 'application/json' },
    }),
  resetDevice: (id: string) =>
    apiFetch<void>(`/api/children/${id}/reset-device`, { method: 'POST' }),
  sendSignal: (id: string) =>
    apiFetch<{ commandId: string; expiresAt: string }>(`/api/children/${id}/signal`, {
      method: 'POST',
    }),
  setProtection: (id: string, enabled: boolean) =>
    apiFetch<ProtectionState>(`/api/children/${id}/protection`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  setAvatar: (id: string, body: SetAvatarInput) =>
    apiFetch<{ avatarKey: string | null }>(`/api/children/${id}/avatar`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  removeAvatar: (id: string) => apiFetch<void>(`/api/children/${id}/avatar`, { method: 'DELETE' }),
  /** Фото — ПДн, отдаётся только под JWT родителя, поэтому не `<img src>`, а blob. */
  fetchAvatar: (id: string) => apiFetchBlob(`/api/children/${id}/avatar`),
};
