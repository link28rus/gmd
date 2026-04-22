import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Missing Bearer token' } },
      { status: 401 },
    );
  }
  const token = auth.slice('Bearer '.length);
  const r = await backend('POST', '/me/seen', undefined, token);
  return new NextResponse(null, { status: r.status === 204 ? 204 : r.status });
}
