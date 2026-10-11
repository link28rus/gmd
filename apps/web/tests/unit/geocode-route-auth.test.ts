/**
 * @jest-environment node
 */
jest.mock('@/lib/backend', () => ({
  backend: jest.fn(),
}));
import { backend } from '@/lib/backend';
import { GET } from '@/app/api/geocode/route';
import { NextRequest } from 'next/server';

const backendMock = backend as jest.MockedFunction<typeof backend>;

function req(token: string | null): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost/api/geocode?reverse=135.07,48.48', { headers });
}

describe('GET /api/geocode — только для вошедших', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    backendMock.mockReset();
    fetchMock.mockReset();
    process.env.YANDEX_GEOCODER_API_KEY = 'test-key';
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('без токена — 401, Яндекс не вызывается', async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(backendMock).not.toHaveBeenCalled();
  });

  it('с недействительным токеном — 401', async () => {
    backendMock.mockResolvedValue({ status: 401, body: null });
    const res = await GET(req('bad-token'));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('с действительным токеном — идёт в Яндекс, повторная проверка берётся из кэша', async () => {
    backendMock.mockResolvedValue({ status: 200, body: {} });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ response: { GeoObjectCollection: { featureMember: [] } } }), {
        status: 200,
      }),
    );
    const first = await GET(req('good-token'));
    expect(first.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await GET(req('good-token'));
    expect(backendMock).toHaveBeenCalledTimes(1);
  });
});
