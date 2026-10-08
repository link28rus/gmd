/**
 * @jest-environment node
 */
jest.mock('@/lib/backend', () => ({
  backend: jest.fn(),
}));
import { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';
import { DELETE, GET, PATCH, POST } from '@/app/api/family/[...path]/route';

const backendMock = backend as jest.MockedFunction<typeof backend>;

function req(
  url: string,
  init: { method?: string; body?: string; token?: string | null } = {},
): NextRequest {
  const headers: Record<string, string> = {};
  const token = init.token === undefined ? 'tkn' : init.token;
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method: init.method ?? 'GET', headers, body: init.body });
}

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });

describe('/api/family/[...path] (dev-прокси)', () => {
  beforeEach(() => backendMock.mockReset());

  it('GET пробрасывает путь, query и токен', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { canJoin: true } });
    const res = await GET(
      req('http://localhost/api/family/member-invites/preview?code=ABCD2345'),
      ctx('member-invites', 'preview'),
    );
    expect(backendMock).toHaveBeenCalledWith(
      'GET',
      '/family/member-invites/preview?code=ABCD2345',
      undefined,
      'tkn',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ canJoin: true });
  });

  it('POST пробрасывает JSON-тело', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { role: 'parent' } });
    const res = await POST(
      req('http://localhost/api/family/member-invites/accept', {
        method: 'POST',
        body: JSON.stringify({ code: 'ABCD2345' }),
      }),
      ctx('member-invites', 'accept'),
    );
    expect(backendMock).toHaveBeenCalledWith(
      'POST',
      '/family/member-invites/accept',
      { code: 'ABCD2345' },
      'tkn',
    );
    expect(res.status).toBe(200);
  });

  it('POST без тела — body undefined', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { family: { id: 'f2', name: 'x' } } });
    await POST(req('http://localhost/api/family/leave', { method: 'POST' }), ctx('leave'));
    expect(backendMock).toHaveBeenCalledWith('POST', '/family/leave', undefined, 'tkn');
  });

  it('PATCH /family/:id', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { family: { id: 'f1', name: 'Новая' } } });
    await PATCH(
      req('http://localhost/api/family/f1', { method: 'PATCH', body: '{"name":"Новая"}' }),
      ctx('f1'),
    );
    expect(backendMock).toHaveBeenCalledWith('PATCH', '/family/f1', { name: 'Новая' }, 'tkn');
  });

  it('DELETE 204 отдаётся без тела', async () => {
    backendMock.mockResolvedValue({ status: 204, body: null });
    const res = await DELETE(
      req('http://localhost/api/family/members/u2', { method: 'DELETE' }),
      ctx('members', 'u2'),
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('ошибка backend проходит как есть', async () => {
    backendMock.mockResolvedValue({
      status: 409,
      body: { error: { code: 'owner_must_transfer', message: '...' } },
    });
    const res = await POST(
      req('http://localhost/api/family/leave', { method: 'POST' }),
      ctx('leave'),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('owner_must_transfer');
  });

  it('без токена — 401 и backend не вызывается', async () => {
    const res = await GET(
      req('http://localhost/api/family/members', { token: null }),
      ctx('members'),
    );
    expect(res.status).toBe(401);
    expect(backendMock).not.toHaveBeenCalled();
  });

  it('невалидный JSON — 400', async () => {
    const res = await POST(
      req('http://localhost/api/family/transfer-ownership', { method: 'POST', body: '{oops' }),
      ctx('transfer-ownership'),
    );
    expect(res.status).toBe(400);
    expect(backendMock).not.toHaveBeenCalled();
  });
});
