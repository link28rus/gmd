import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

const REFRESH_COOKIE = 'gmd_refresh';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const isMobile = req.headers.get('x-client')?.startsWith('mobile') ?? false;
  let token = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!token && isMobile) {
    const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
    token = body.refreshToken;
  }
  if (token) {
    await backend('POST', '/auth/logout', { refreshToken: token });
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
