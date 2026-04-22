import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

interface ResetBody {
  token?: string;
  password?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Partial<ResetBody>;
  const r = await backend('POST', '/auth/reset-password', {
    token: body.token,
    password: body.password,
  });
  return NextResponse.json(r.body ?? {}, { status: r.status });
}
