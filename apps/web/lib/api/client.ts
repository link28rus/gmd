// apps/web/lib/api/client.ts
'use client';

import { useAuthStore } from '@/lib/auth-store';
import { refreshAccessToken } from '@/lib/auth/refresh-singleflight';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function doFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const store = useAuthStore.getState();
  let res = await doFetch(path, init, store.accessToken);

  if (res.status === 401) {
    const data = await refreshAccessToken();
    if (data) {
      if (data.user && data.family) {
        useAuthStore.getState().setAll({
          accessToken: data.accessToken,
          user: data.user,
          family: data.family,
        });
      } else {
        useAuthStore.getState().setAccess(data.accessToken);
      }
      res = await doFetch(path, init, data.accessToken);
    }
  }

  const text = await res.text();
  const body = text
    ? (JSON.parse(text) as { error?: { code?: string; message?: string } } | T)
    : null;

  if (!res.ok) {
    const errPayload =
      (body as { error?: { code?: string; message?: string } } | null)?.error ?? {};
    throw new ApiError(
      res.status,
      errPayload.code ?? 'unknown',
      errPayload.message ?? res.statusText,
    );
  }

  return body as T;
}
