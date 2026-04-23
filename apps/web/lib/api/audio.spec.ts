import { audioApi } from './audio';

// Mock apiFetch
jest.mock('./client', () => ({
  apiFetch: jest.fn(),
}));
import { apiFetch } from './client';

const apiFetchMock = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('audioApi', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('createSession отправляет POST с childId/durationSec/hiddenMode', async () => {
    apiFetchMock.mockResolvedValueOnce({
      id: 'sess-1',
      state: 'PENDING',
      expiresAt: '2026-04-24T10:00:00.000Z',
      turnCreds: { url: 'turn:t', username: 'u', password: 'p', ttl: 360 },
    });

    const res = await audioApi.createSession({ childId: 'c1', durationSec: 120, hiddenMode: true });

    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions', {
      method: 'POST',
      body: JSON.stringify({ childId: 'c1', durationSec: 120, hiddenMode: true }),
    });
    expect(res.id).toBe('sess-1');
  });

  it('sendAnswer отправляет SDP на /:id/answer', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);
    await audioApi.sendAnswer('sess-1', 'v=0\r\n...');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions/sess-1/answer', {
      method: 'POST',
      body: JSON.stringify({ sdp: 'v=0\r\n...' }),
    });
  });

  it('sendIce отправляет candidate на /:id/ice', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);
    await audioApi.sendIce('sess-1', 'candidate:0 1 UDP ...');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions/sess-1/ice', {
      method: 'POST',
      body: JSON.stringify({ candidate: 'candidate:0 1 UDP ...' }),
    });
  });

  it('stopSession делает POST на /:id/stop', async () => {
    apiFetchMock.mockResolvedValueOnce(undefined);
    await audioApi.stopSession('sess-1');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/audio/sessions/sess-1/stop', {
      method: 'POST',
    });
  });
});
