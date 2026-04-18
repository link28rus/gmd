import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const r = await backend('POST', '/auth/request-otp', { email: body.email });
  return NextResponse.json(r.body ?? {}, { status: r.status });
}
