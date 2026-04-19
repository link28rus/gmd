// apps/web/lib/hooks/use-location-history.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { locationsApi, type LocationHistoryDto } from '@/lib/api/locations';
import { dayBoundsIso, isToday } from '@/lib/date/day-bounds';

export function useLocationHistory(childId: string, date: string) {
  const query = useQuery<LocationHistoryDto>({
    queryKey: ['location', 'history', childId, date],
    queryFn: () => {
      const [from, to] = dayBoundsIso(date);
      return locationsApi.getHistory(childId, from, to, 2000);
    },
    enabled: !!childId && !!date,
    staleTime: date && isToday(date) ? 30_000 : 5 * 60_000,
    refetchInterval: date && isToday(date) ? 60_000 : false,
    gcTime: 60 * 60_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });

  const isTruncated =
    !!query.data && query.data.items.length >= 2000 && query.data.nextCursor !== null;

  return { query, isTruncated };
}
