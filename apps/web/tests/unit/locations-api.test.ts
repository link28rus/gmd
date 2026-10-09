/**
 * @jest-environment node
 */
import { locationsApi } from '@/lib/api/locations';

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

describe('locationsApi', () => {
  it('getLatest: возвращает LatestLocationDto при 200', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          lat: 55.75,
          lon: 37.61,
          recordedAt: '2026-04-19T10:00:00.000Z',
          serverReceivedAt: '2026-04-19T10:00:01.000Z',
          accuracy: 8,
          altitude: null,
          speed: null,
          bearing: null,
          batteryLevel: 73,
          isCharging: false,
          provider: 'fused',
          ageSec: 42,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const data = await locationsApi.getLatest('c1');
    expect(data).not.toBeNull();
    expect(data!.lat).toBe(55.75);
    expect(data!.ageSec).toBe(42);
  });

  it('getLatest: возвращает null при 204', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const data = await locationsApi.getLatest('c1');
    expect(data).toBeNull();
  });

  it('getHistory: передаёт from/to/order/limit в query', async () => {
    const mock = (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
    );
    await locationsApi.getHistory(
      'c1',
      '2026-04-19T00:00:00.000Z',
      '2026-04-19T23:59:59.999Z',
      2000,
    );
    const url = mock.mock.calls[0][0] as string;
    expect(url).toContain('/api/children/c1/location/history');
    expect(url).toContain('from=2026-04-19T00%3A00%3A00.000Z');
    expect(url).toContain('to=2026-04-19T23%3A59%3A59.999Z');
    expect(url).toContain('order=asc');
    expect(url).toContain('limit=2000');
    // v0.80.0: по умолчанию — трек по дорогам.
    expect(url).toContain('view=road');
  });

  it('v0.80.0: getHistory/getActiveTrack/getTripPoints передают view', async () => {
    const mock = global.fetch as jest.Mock;
    mock.mockImplementation(
      async () => new Response(JSON.stringify({ items: [], points: [] }), { status: 200 }),
    );
    await locationsApi.getHistory('c1', 'a', 'b', 2000, 'recorded');
    await locationsApi.getActiveTrack('c1', 'recorded');
    await locationsApi.getTripPoints('c1', 't1', 'road');
    const urls = mock.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toContain('view=recorded');
    expect(urls[1]).toContain('/api/children/c1/trips/active-track?view=recorded');
    expect(urls[2]).toContain('/api/children/c1/trips/t1/points?view=road');
  });
});
