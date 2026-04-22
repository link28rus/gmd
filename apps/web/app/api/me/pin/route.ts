import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

// Роут опирается на Authorization header — Next.js должен понять что это
// dynamic и не кэшировать build-time snapshot (симптом: GET всегда возвращает
// одно и то же значение — исходное в момент билда).
export const dynamic = 'force-dynamic';

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'unauthorized', message: 'Missing Bearer token' } },
    { status: 401 },
  );
}

function takeToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = takeToken(req);
  if (!token) return unauthorized();
  const r = await backend('GET', '/me/pin/status', undefined, token);
  if (r.body === null) return new NextResponse(null, { status: r.status });
  return NextResponse.json(r.body, { status: r.status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = takeToken(req);
  if (!token) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as unknown;
  const r = await backend('POST', '/me/pin', body, token);
  if (r.body === null) return new NextResponse(null, { status: r.status });
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const token = takeToken(req);
  if (!token) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as unknown;
  const r = await backend('DELETE', '/me/pin', body, token);
  if (r.status === 204 || r.body === null) {
    return new NextResponse(null, { status: r.status });
  }
  return NextResponse.json(r.body, { status: r.status });
}
