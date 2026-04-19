/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('@/lib/api/locations', () => ({
  locationsApi: { getLatest: jest.fn() },
}));
import { locationsApi } from '@/lib/api/locations';
import { useLatestLocation } from '@/lib/hooks/use-latest-location';

const getLatestMock = locationsApi.getLatest as jest.MockedFunction<typeof locationsApi.getLatest>;

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe('useLatestLocation', () => {
  beforeEach(() => getLatestMock.mockReset());

  it('возвращает data при 200', async () => {
    getLatestMock.mockResolvedValue({ lat: 1, lon: 2, ageSec: 5 } as any);
    const { result } = renderHook(() => useLatestLocation('c1'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ lat: 1, lon: 2, ageSec: 5 });
  });

  it('возвращает data=null при 204', async () => {
    getLatestMock.mockResolvedValue(null);
    const { result } = renderHook(() => useLatestLocation('c1'), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('enabled=false если childId пустой', () => {
    const { result } = renderHook(() => useLatestLocation(''), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(getLatestMock).not.toHaveBeenCalled();
  });
});
