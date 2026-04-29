import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

interface VerifyOtpBody {
  email: string;
  code: string;
}

interface BackendVerifyResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string | null; locale: string };
  family: { id: string; name: string };
}

interface BackendMeResponse {
  user: { id: string; email: string; name: string | null; locale: string };
  isAdmin: boolean;
  hasPassword: boolean;
  hasPin: boolean;
}

const REFRESH_COOKIE = 'gmd_refresh';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Partial<VerifyOtpBody>;
  const r = await backend<BackendVerifyResponse>('POST', '/auth/verify-otp', {
    email: body.email,
    code: body.code,
  });
  if (r.status !== 200 || !r.body) {
    return NextResponse.json(r.body ?? {}, { status: r.status });
  }
  const { accessToken, refreshToken, user, family } = r.body;
  const me = await backend<BackendMeResponse>('GET', '/me', undefined, accessToken);
  const enrichedUser =
    me.status === 200 && me.body
      ? {
          ...user,
          isAdmin: me.body.isAdmin ?? false,
          hasPassword: me.body.hasPassword ?? false,
          hasPin: me.body.hasPin ?? false,
        }
      : user;
  const isMobile = req.headers.get('x-client')?.startsWith('mobile') ?? false;
  const res = NextResponse.json({
    accessToken,
    user: enrichedUser,
    family,
    ...(isMobile ? { refreshToken } : {}),
  });
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.ALLOW_INSECURE_COOKIE !== 'true' && process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_MAX_AGE,
  });
  return res;
}
