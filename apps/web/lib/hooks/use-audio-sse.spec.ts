/** @jest-environment jsdom */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAudioSse } from './use-audio-sse';

jest.mock('@/lib/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ accessToken: 'test-token' }),
  },
}));

function chunks(...parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < parts.length) {
        ctrl.enqueue(enc.encode(parts[i++]));
      } else {
        ctrl.close();
      }
    },
  });
}

describe('useAudioSse', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('парсит цепочку data:-строк и вызывает onEvent для каждой', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: chunks(
        'data: {"state":"PENDING","payload":null}\n\n',
        'data: {"state":"READY","payload":{"sdp":"v=0"}}\n\n',
        'data: {"state":"ENDED","payload":{"actualSec":12}}\n\n',
      ),
    }) as unknown as typeof fetch;

    const onEvent = jest.fn();
    const onError = jest.fn();

    renderHook(() => useAudioSse({ sessionId: 'sess-1', enabled: true, onEvent, onError }));

    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(3));

    expect(onEvent).toHaveBeenNthCalledWith(1, { state: 'PENDING', payload: null });
    expect(onEvent).toHaveBeenNthCalledWith(2, { state: 'READY', payload: { sdp: 'v=0' } });
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      state: 'ENDED',
      payload: { actualSec: 12 },
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('склеивает event через два chunk (data: половина + остаток)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: chunks('data: {"state":"REA', 'DY","payload":{"sdp":"v=0"}}\n\n'),
    }) as unknown as typeof fetch;

    const onEvent = jest.fn();
    renderHook(() =>
      useAudioSse({ sessionId: 'sess-2', enabled: true, onEvent, onError: jest.fn() }),
    );
    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
    expect(onEvent).toHaveBeenCalledWith({ state: 'READY', payload: { sdp: 'v=0' } });
  });

  it('не открывает соединение при enabled=false', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    renderHook(() =>
      useAudioSse({ sessionId: 'x', enabled: false, onEvent: jest.fn(), onError: jest.fn() }),
    );
    await act(() => Promise.resolve());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('вызывает onError при HTTP 4xx/5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
    }) as unknown as typeof fetch;
    const onError = jest.fn();
    renderHook(() => useAudioSse({ sessionId: 'x', enabled: true, onEvent: jest.fn(), onError }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
