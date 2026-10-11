/**
 * @jest-environment node
 */
jest.mock('@/lib/backend', () => ({
  backend: jest.fn(),
}));
import { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';
import { POST } from '@/app/api/auth/set-password/route';

const backendMock = backend as jest.MockedFunction<typeof backend>;

function req(body: unknown, token: string | null = 'tkn'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost/api/auth/set-password', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/set-password', () => {
  beforeEach(() => backendMock.mockReset());

  it('без Bearer → 401, backend не вызывается', async () => {
    const res = await POST(req({ password: 'newPassword1' }, null));
    expect(res.status).toBe(401);
    expect(backendMock).not.toHaveBeenCalled();
  });

  it('успех: пробрасывает currentPassword, ставит новую cookie, отдаёт только access', async () => {
    backendMock.mockResolvedValue({
      status: 200,
      body: { accessToken: 'at2', refreshToken: 'rt2' },
    });
    const res = await POST(req({ password: 'newPassword1', currentPassword: 'old' }));
    expect(backendMock).toHaveBeenCalledWith(
      'POST',
      '/auth/set-password',
      { password: 'newPassword1', currentPassword: 'old' },
      'tkn',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessToken: 'at2' });
    const cookie = res.cookies.get('gmd_refresh');
    expect(cookie?.value).toBe('rt2');
    expect(cookie?.httpOnly).toBe(true);
  });

  it('неверный текущий пароль: ошибка backend как есть, cookie не трогаем', async () => {
    backendMock.mockResolvedValue({
      status: 400,
      body: { error: { code: 'invalid_current_password', message: 'x' } },
    });
    const res = await POST(req({ password: 'newPassword1', currentPassword: 'bad' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'invalid_current_password', message: 'x' },
    });
    expect(res.cookies.get('gmd_refresh')).toBeUndefined();
  });
});
