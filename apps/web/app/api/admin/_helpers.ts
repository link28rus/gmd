// apps/web/app/api/admin/_helpers.ts
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { backend, type BackendResponse } from '@/lib/backend';

export function getBearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization');
  return h && h.startsWith('Bearer ') ? h.slice(7) : null;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'Missing Bearer token' } },
    { status: 401 },
  );
}

/**
 * Ответ бекенда → NextResponse. 204 отдаём без тела: `NextResponse.json` с
 * 204 бросает TypeError (null-body status), а DELETE-эндпоинты могут так ответить.
 */
function adminResponse(r: BackendResponse<unknown>): NextResponse {
  if (r.status === 204) return new NextResponse(null, { status: 204 });
  return NextResponse.json(r.body ?? {}, { status: r.status });
}

/**
 * Proxy a GET request to the backend admin API, forwarding the query string.
 */
export async function proxyAdminGet(backendPath: string, req: NextRequest): Promise<NextResponse> {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const qs = req.nextUrl.search; // includes "?" or empty string
  const r = await backend('GET', `${backendPath}${qs}`, undefined, token);
  return adminResponse(r);
}

/**
 * Универсальный write-proxy (POST/PATCH/DELETE) на бекенд. Тело передаётся
 * без изменений, JWT берётся из заголовка Bearer. Используется для действий
 * над пользователями (роль, блокировка, сброс пароля, удаление) и прочих
 * admin-mutations.
 */
export async function proxyAdminWrite(
  method: 'POST' | 'PATCH' | 'DELETE',
  backendPath: string,
  req: NextRequest,
): Promise<NextResponse> {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const body = method === 'DELETE' ? undefined : ((await req.json().catch(() => ({}))) as unknown);
  const r = await backend(method, backendPath, body, token);
  return adminResponse(r);
}
