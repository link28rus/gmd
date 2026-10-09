import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

function bearer(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  return auth && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'Missing Bearer token' } },
    { status: 401 },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = bearer(req);
  if (!token) return unauthorized();
  const r = await backend('GET', '/me', undefined, token);
  return NextResponse.json(r.body ?? {}, { status: r.status });
}

// v0.75.0: ФИО из профиля кабинета. На проде Caddy отдаёт /api/me в web.
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const token = bearer(req);
  if (!token) return unauthorized();
  const body: unknown = await req.json().catch(() => ({}));
  const r = await backend('PATCH', '/me', body, token);
  return NextResponse.json(r.body ?? {}, { status: r.status });
}
