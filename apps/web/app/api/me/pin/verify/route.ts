import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Missing Bearer token' } },
      { status: 401 },
    );
  }
  const token = auth.slice('Bearer '.length);
  const body = (await req.json().catch(() => ({}))) as unknown;
  const r = await backend('POST', '/me/pin/verify', body, token);
  if (r.body === null) return new NextResponse(null, { status: r.status });
  return NextResponse.json(r.body, { status: r.status });
}
