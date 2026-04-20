// apps/web/app/api/zones/_helpers.ts
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

export async function proxy(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  backendPath: string,
  req: NextRequest,
  body?: unknown,
): Promise<NextResponse> {
  const token = getBearer(req);
  if (!token) return unauthorizedResponse();
  const r = await backend(method, backendPath, body, token);
  return proxyResponse(r);
}
