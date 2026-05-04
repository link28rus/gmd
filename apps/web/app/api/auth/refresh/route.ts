import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';

interface BackendRefreshResponse {
  accessToken: string;
  refreshToken: string;
}

interface BackendMeResponse {
  user: { id: string; email: string; name: string | null; locale: string };
  family: { id: string; name: string };
  memberships: Array<{ role: string; familyId: string }>;
  isAdmin: boolean;
  hasPassword: boolean;
  requiresConsent: boolean;
  currentPolicyVersion: string;
}

const REFRESH_COOKIE = 'gmd_refresh';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Web берёт refresh из HttpOnly cookie, mobile — из body (нет cookie-jar).
  const isMobile = req.headers.get('x-client')?.startsWith('mobile') ?? false;
  let old = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!old && isMobile) {
    const body = (await req.json().catch(() => ({}))) as { refreshToken?: string };
    old = body.refreshToken;
  }
  if (!old) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'No refresh cookie' } },
      { status: 401 },
    );
  }
  const r = await backend<BackendRefreshResponse>('POST', '/auth/refresh', { refreshToken: old });
  if (r.status !== 200 || !r.body) {
    const res = NextResponse.json(r.body ?? {}, { status: r.status });
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }
  const { accessToken, refreshToken } = r.body;
  const me = await backend<BackendMeResponse>('GET', '/me', undefined, accessToken);
  const meUser =
    me.status === 200 && me.body
      ? {
          ...me.body.user,
          isAdmin: me.body.isAdmin ?? false,
          hasPassword: me.body.hasPassword ?? false,
        }
      : undefined;
  const res = NextResponse.json({
    accessToken,
    ...(meUser && me.body
      ? {
          user: meUser,
          family: me.body.family,
          requiresConsent: me.body.requiresConsent ?? false,
        }
      : {}),
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
