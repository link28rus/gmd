// apps/web/lib/hooks/use-latest-location.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { locationsApi, type LatestLocationDto } from '@/lib/api/locations';

export function useLatestLocation(childId: string) {
  return useQuery<LatestLocationDto | null>({
    queryKey: ['location', 'latest', childId],
    queryFn: () => locationsApi.getLatest(childId),
    enabled: !!childId,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 15_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    retry: 1,
  });
}
