/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('@/lib/api/locations', () => ({
  locationsApi: { getHistory: jest.fn() },
}));
import { locationsApi } from '@/lib/api/locations';
import { useLocationHistory } from '@/lib/hooks/use-location-history';

const getHistoryMock = locationsApi.getHistory as jest.MockedFunction<
  typeof locationsApi.getHistory
>;

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useLocationHistory', () => {
  beforeEach(() => getHistoryMock.mockReset());

  it('items < 2000 → isTruncated=false', async () => {
    getHistoryMock.mockResolvedValue({
      items: [{ lat: 1, lon: 2, recordedAt: 'x', accuracy: null, speed: null }],
      nextCursor: null,
    });
    const { result } = renderHook(() => useLocationHistory('c1', '2026-04-18'), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data?.items.length).toBe(1);
    expect(result.current.isTruncated).toBe(false);
  });

  it('items=2000 + nextCursor → isTruncated=true', async () => {
    const items = Array.from({ length: 2000 }, () => ({
      lat: 0,
      lon: 0,
      recordedAt: 'x',
      accuracy: null,
      speed: null,
    }));
    getHistoryMock.mockResolvedValue({ items, nextCursor: '2026-04-19T00:00:00.000Z' });
    const { result } = renderHook(() => useLocationHistory('c1', '2026-04-18'), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.isTruncated).toBe(true);
  });

  it('enabled=false если date пустой', () => {
    const { result } = renderHook(() => useLocationHistory('c1', ''), { wrapper: wrap() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(getHistoryMock).not.toHaveBeenCalled();
  });
});
