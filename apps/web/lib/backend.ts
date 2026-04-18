import 'server-only';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:3001';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T) : null;
  return { status: res.status, body: json };
}
