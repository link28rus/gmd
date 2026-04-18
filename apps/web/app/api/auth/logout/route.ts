import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

const REFRESH_COOKIE = 'gmd_refresh';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(REFRESH_COOKIE)?.value;
  if (token) {
    await backend('POST', '/auth/logout', { refreshToken: token });
  }
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
