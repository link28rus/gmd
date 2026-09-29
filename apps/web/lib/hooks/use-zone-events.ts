// apps/web/lib/hooks/use-zone-events.ts
'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { zonesApi } from '@/lib/api/zones';

export interface ZoneEventsFilters {
  childId?: string;
  zoneId?: string;
}

const PAGE_SIZE = 50;

/**
 * Лента событий геозон с курсорной пагинацией (`nextCursor`). Опрос раз в 30 с
 * перезапрашивает все загруженные страницы; на скрытой вкладке — пауза.
 */
export function useZoneEvents(filters: ZoneEventsFilters = {}) {
  const childId = filters.childId || undefined;
  const zoneId = filters.zoneId || undefined;
  return useInfiniteQuery({
    queryKey: ['zone-events', { childId, zoneId }],
    queryFn: ({ pageParam }) =>
      zonesApi.listEvents({ childId, zoneId, limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: 1,
  });
}
