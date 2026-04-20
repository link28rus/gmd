// apps/web/lib/hooks/use-zone-events.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { zonesApi, type ZoneEventsPage, type ListEventsQuery } from '@/lib/api/zones';

export function useZoneEvents(q: ListEventsQuery = {}) {
  return useQuery<ZoneEventsPage>({
    queryKey: ['zone-events', q],
    queryFn: () => zonesApi.listEvents(q),
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: 1,
  });
}
