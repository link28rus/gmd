import 'server-only';

import { headers } from 'next/headers';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001';

/**
 * IP клиента для backend: rate-limit (Throttler) и журнал входов считают по
 * req.ip, а backend доверяет X-Forwarded-For из docker-сети (trust proxy).
 * Без проброса все запросы через web шли с одного IP контейнера — лимит входа
 * и OTP делили все пользователи сразу. Caddy заменяет пришедший снаружи XFF
 * адресом клиента, так что подделать его нельзя. Вне запроса (сборка) — нет.
 */
async function forwardedFor(): Promise<Record<string, string>> {
  try {
    const xff = (await headers()).get('x-forwarded-for');
    return xff ? { 'X-Forwarded-For': xff } : {};
  } catch {
    return {};
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface BackendResponse<T = unknown> {
  status: number;
  body: T | null;
}

export async function backend<T = unknown>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  accessToken?: string,
): Promise<BackendResponse<T>> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(await forwardedFor()),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T) : null;
  return { status: res.status, body: json };
}
