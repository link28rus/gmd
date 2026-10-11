import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';
import { REFRESH_COOKIE, REFRESH_MAX_AGE } from '@/lib/auth/session-cookie';

interface BackendSetPasswordResponse {
  accessToken: string;
  refreshToken: string;
}

/**
 * Смена/установка пароля из кабинета. Backend отзывает все refresh-токены
 * пользователя и отдаёт новую пару: refresh кладём в cookie (иначе следующий
 * /auth/refresh разлогинит), access возвращаем клиенту в auth-store.
 */
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
  const r = await backend<BackendSetPasswordResponse>('POST', '/auth/set-password', body, token);
  if (r.status !== 200 || !r.body) {
    if (r.body === null) return new NextResponse(null, { status: r.status });
    return NextResponse.json(r.body, { status: r.status });
  }
  const { accessToken, refreshToken } = r.body;
  const res = NextResponse.json({ accessToken });
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.ALLOW_INSECURE_COOKIE !== 'true' && process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REFRESH_MAX_AGE,
  });
  return res;
}
