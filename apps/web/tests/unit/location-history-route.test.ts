/**
 * @jest-environment node
 */
jest.mock('@/lib/backend', () => ({
  backend: jest.fn(),
}));
import { backend } from '@/lib/backend';
import { GET } from '@/app/api/children/[id]/location/history/route';
import { NextRequest } from 'next/server';

const backendMock = backend as jest.MockedFunction<typeof backend>;

function req(url: string, token: string | null = 'tkn'): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { headers });
}

describe('GET /api/children/:id/location/history', () => {
  beforeEach(() => backendMock.mockReset());

  it('прокидывает from/to/order/limit на backend', async () => {
    backendMock.mockResolvedValue({ status: 200, body: { items: [], nextCursor: null } });
    await GET(
      req(
        'http://localhost/api/children/c1/location/history?from=2026-04-19T00:00:00.000Z&to=2026-04-19T23:59:59.999Z&order=asc&limit=2000',
      ),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    const [method, path, body, token] = backendMock.mock.calls[0];
    expect(method).toBe('GET');
    expect(path).toBe(
      '/children/c1/locations?from=2026-04-19T00%3A00%3A00.000Z&to=2026-04-19T23%3A59%3A59.999Z&order=asc&limit=2000',
    );
    expect(body).toBeUndefined();
    expect(token).toBe('tkn');
  });

  it('401 без Bearer', async () => {
    const res = await GET(
      req('http://localhost/api/children/c1/location/history?from=a&to=b', null),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(401);
  });

  it('400 при отсутствии from/to', async () => {
    const res = await GET(req('http://localhost/api/children/c1/location/history'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    expect(res.status).toBe(400);
  });
});
