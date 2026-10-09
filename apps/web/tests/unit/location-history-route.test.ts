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

  it('берёт очищенный трек с backend /track и отдаёт в формате истории', async () => {
    backendMock.mockResolvedValue({
      status: 200,
      body: {
        points: [{ lat: 48.4, lon: 135.1, recordedAt: '2026-04-19T08:00:00.000Z' }],
        stays: [
          {
            lat: 48.4,
            lon: 135.1,
            from: '2026-04-19T07:00:00.000Z',
            to: '2026-04-19T08:00:00.000Z',
          },
        ],
      },
    });
    const res = await GET(
      req(
        'http://localhost/api/children/c1/location/history?from=2026-04-19T00:00:00.000Z&to=2026-04-19T23:59:59.999Z&order=asc&limit=2000',
      ),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    const [method, path, body, token] = backendMock.mock.calls[0];
    expect(method).toBe('GET');
    expect(path).toBe(
      '/children/c1/track?from=2026-04-19T00%3A00%3A00.000Z&to=2026-04-19T23%3A59%3A59.999Z',
    );
    expect(body).toBeUndefined();
    expect(token).toBe('tkn');
    expect(await res.json()).toEqual({
      items: [
        {
          lat: 48.4,
          lon: 135.1,
          recordedAt: '2026-04-19T08:00:00.000Z',
          accuracy: null,
          speed: null,
        },
      ],
      nextCursor: null,
      stays: [
        { lat: 48.4, lon: 135.1, from: '2026-04-19T07:00:00.000Z', to: '2026-04-19T08:00:00.000Z' },
      ],
    });
  });

  it('v0.80.0: view уходит в backend, флаг inferred сохраняется', async () => {
    backendMock.mockResolvedValue({
      status: 200,
      body: {
        points: [
          { lat: 48.4, lon: 135.1, recordedAt: '2026-04-19T08:00:00.000Z' },
          { lat: 48.41, lon: 135.1, recordedAt: '2026-04-19T08:10:00.000Z', inferred: true },
        ],
        stays: [],
      },
    });
    const res = await GET(
      req(
        'http://localhost/api/children/c1/location/history?from=2026-04-19T00:00:00.000Z&to=2026-04-19T23:59:59.999Z&view=recorded',
      ),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(backendMock.mock.calls[0][1]).toBe(
      '/children/c1/track?from=2026-04-19T00%3A00%3A00.000Z&to=2026-04-19T23%3A59%3A59.999Z&view=recorded',
    );
    const json = await res.json();
    expect(json.items[0].inferred).toBeUndefined();
    expect(json.items[1]).toEqual({
      lat: 48.41,
      lon: 135.1,
      recordedAt: '2026-04-19T08:10:00.000Z',
      inferred: true,
      accuracy: null,
      speed: null,
    });
  });

  it('v0.80.0: неизвестный view → 400', async () => {
    const res = await GET(
      req(
        'http://localhost/api/children/c1/location/history?from=2026-04-19T00:00:00.000Z&to=2026-04-19T23:59:59.999Z&view=bogus',
      ),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(400);
    expect(backendMock).not.toHaveBeenCalled();
  });

  it('ошибку backend пробрасывает как есть', async () => {
    backendMock.mockResolvedValue({ status: 403, body: { code: 'forbidden' } });
    const res = await GET(
      req(
        'http://localhost/api/children/c1/location/history?from=2026-04-19T00:00:00.000Z&to=2026-04-19T23:59:59.999Z',
      ),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(403);
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
