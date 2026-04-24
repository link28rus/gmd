import { audioApi } from './audio';

// Mock apiFetch
jest.mock('./client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from './client';

const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('audioApi', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('createSession отправляет POST с childId/durationSec/hiddenMode и парсит ws', async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: 'sess-1',
      state: 'PENDING',
      expiresAt: '2026-04-24T10:00:00.000Z',
      ws: {
        url: 'wss://gmd.test/audio/ws?role=parent&sessionId=sess-1&token=xxx',
        token: 'xxx',
        ttlSec: 360,
      },
    });

    const res = await audioApi.createSession({ childId: 'c1', durationSec: 120, hiddenMode: true });

    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions', {
      method: 'POST',
      body: JSON.stringify({ childId: 'c1', durationSec: 120, hiddenMode: true }),
    });
    expect(res.id).toBe('sess-1');
    expect(res.ws.url).toContain('role=parent');
    expect(res.ws.token).toBe('xxx');
    expect(res.ws.ttlSec).toBe(360);
  });

  it('stopSession делает POST на /:id/stop', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);
    await audioApi.stopSession('sess-1');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions/sess-1/stop', {
      method: 'POST',
    });
  });
});
