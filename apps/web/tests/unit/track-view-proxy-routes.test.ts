/**
 * @jest-environment node
 */
// v0.80.0: прокси трека пробрасывают view=road|recorded в backend.
jest.mock('@/lib/backend', () => ({
  backend: jest.fn(),
}));
import { NextRequest } from 'next/server';
import { backend } from '@/lib/backend';
import { GET as getActiveTrack } from '@/app/api/children/[id]/trips/active-track/route';
import { GET as getTripPoints } from '@/app/api/children/[id]/trips/[tripId]/points/route';

const backendMock = backend as jest.MockedFunction<typeof backend>;

function req(url: string): NextRequest {
  return new NextRequest(url, { headers: { authorization: 'Bearer tkn' } });
}

describe('прокси трека: view', () => {
  beforeEach(() => {
    backendMock.mockReset();
    backendMock.mockResolvedValue({ status: 200, body: { points: [] } });
  });

  it('active-track: view=recorded уходит в backend', async () => {
    await getActiveTrack(req('http://localhost/api/children/c1/trips/active-track?view=recorded'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    expect(backendMock.mock.calls[0][1]).toBe('/children/c1/trips/active-track?view=recorded');
  });

  it('active-track: без view — прежний путь', async () => {
    await getActiveTrack(req('http://localhost/api/children/c1/trips/active-track'), {
      params: Promise.resolve({ id: 'c1' }),
    });
    expect(backendMock.mock.calls[0][1]).toBe('/children/c1/trips/active-track');
  });

  it('points: view=road уходит, мусор отбрасывается', async () => {
    await getTripPoints(req('http://localhost/api/children/c1/trips/t1/points?view=road'), {
      params: Promise.resolve({ id: 'c1', tripId: 't1' }),
    });
    await getTripPoints(req('http://localhost/api/children/c1/trips/t1/points?view=x'), {
      params: Promise.resolve({ id: 'c1', tripId: 't1' }),
    });
    expect(backendMock.mock.calls[0][1]).toBe('/children/c1/trips/t1/points?view=road');
    expect(backendMock.mock.calls[1][1]).toBe('/children/c1/trips/t1/points');
  });
});
