import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

interface LoginPasswordBody {
  email: string;
  password: string;
}

interface BackendLoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string | null; locale: string };
  family: { id: string; name: string };
}

const REFRESH_COOKIE = 'gmd_refresh';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Partial<LoginPasswordBody>;
  const r = await backend<BackendLoginResponse>('POST', '/auth/login-password', {
    email: body.email,
    password: body.password,
  });
  if (r.status !== 200 || !r.body) {
    return NextResponse.json(r.body ?? {}, { status: r.status });
  }
  const { accessToken, refreshToken, user, family } = r.body;
  const res = NextResponse.json({ accessToken, user, family });
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.ALLOW_INSECURE_COOKIE !== 'true' && process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_MAX_AGE,
  });
  return res;
}
