import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Missing Bearer token' } },
      { status: 401 },
    );
  }
  const token = auth.slice('Bearer '.length);
  const r = await backend('GET', '/me', undefined, token);
  return NextResponse.json(r.body ?? {}, { status: r.status });
}
