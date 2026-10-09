// apps/web/app/api/children/_helpers.ts
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

export function proxyResponse(r: BackendResponse<unknown>): NextResponse {
  if (r.status === 204 || r.body === null) {
    return new NextResponse(null, { status: r.status });
  }
  return NextResponse.json(r.body, { status: r.status });
}

/**
 * v0.80.0: query `view=road|recorded` для эндпоинтов трека — пробрасываем в
 * backend как есть; без параметра (или с мусором) — пусто, backend сам берёт
 * road. Возвращает строку для дописывания к пути: `?view=…` или `''`.
 */
export function trackViewQuery(req: NextRequest): string {
  const view = req.nextUrl.searchParams.get('view');
  return view === 'road' || view === 'recorded' ? `?view=${view}` : '';
}

export async function proxy(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  backendPath: string,
  req: NextRequest,
  body?: unknown,
): Promise<NextResponse> {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const r = await backend(method, backendPath, body, token);
  return proxyResponse(r);
}
