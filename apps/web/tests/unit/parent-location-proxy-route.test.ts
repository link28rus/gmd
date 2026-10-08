/**
 * @jest-environment node
 */
jest.mock('@/lib/backend', () => ({
  backend: jest.fn(),
}));
import { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';
import { GET as getDevices } from '@/app/api/parent-location/my-devices/route';
import { GET as getTrack } from '@/app/api/parent-location/my-devices/[deviceId]/track/route';
import { POST as postSignal } from '@/app/api/parent-location/my-devices/[deviceId]/signal/route';

const backendMock = backend as jest.MockedFunction<typeof backend>;

function req(url: string, init: { method?: string; token?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = {};
  const token = init.token === undefined ? 'tkn' : init.token;
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method: init.method ?? 'GET', headers });
}

const ctx = (deviceId: string) => ({ params: Promise.resolve({ deviceId }) });

describe('/api/parent-location/my-devices* (dev-прокси «Найти телефон»)', () => {
  beforeEach(() => backendMock.mockReset());

  it('GET my-devices пробрасывает токен', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { items: [] } });
    const res = await getDevices(req('http://localhost/api/parent-location/my-devices'));
    expect(backendMock).toHaveBeenCalledWith(
      'GET',
      '/parent-location/my-devices',
      undefined,
      'tkn',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it('GET track пробрасывает query string как есть', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { items: [] } });
    const qs = '?from=2026-10-08T21%3A00%3A00.000Z&to=2026-10-09T21%3A00%3A00.000Z';
    await getTrack(
      req(`http://localhost/api/parent-location/my-devices/dev1/track${qs}`),
      ctx('dev1'),
    );
    expect(backendMock).toHaveBeenCalledWith(
      'GET',
      `/parent-location/my-devices/dev1/track${qs}`,
      undefined,
      'tkn',
    );
  });

  it('POST signal отдаёт статус backend (429 — лимит)', async () => {
    backendMock.mockResolvedValue({
      status: 429,
      body: { error: { code: 'too_many_requests', message: 'ThrottlerException' } },
    });
    const res = await postSignal(
      req('http://localhost/api/parent-location/my-devices/dev1/signal', { method: 'POST' }),
      ctx('dev1'),
    );
    expect(backendMock).toHaveBeenCalledWith(
      'POST',
      '/parent-location/my-devices/dev1/signal',
      undefined,
      'tkn',
    );
    expect(res.status).toBe(429);
  });

  it('без Bearer — 401, backend не вызывается', async () => {
    const res = await getDevices(
      req('http://localhost/api/parent-location/my-devices', { token: null }),
    );
    expect(res.status).toBe(401);
    expect(backendMock).not.toHaveBeenCalled();
  });
});
