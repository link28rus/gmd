// apps/web/lib/hooks/use-trips-list.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { locationsApi, type TripDto } from '@/lib/api/locations';
import { dayBoundsIso, isToday } from '@/lib/date/day-bounds';

/**
 * v0.31.0 — список завершённых "поездок" ребёнка за выбранный день.
 * Используется в map-client для рисования stop-маркеров поверх трека.
 *
 * Для "сегодня" — refetch каждые 30с (поездки медленно появляются,
 * не надо дёргать чаще). Для прошлых дней — stale 5 мин.
 */
export function useTripsList(childId: string, date: string) {
  return useQuery<{ trips: TripDto[] }>({
    queryKey: ['trips', 'list', childId, date],
    queryFn: () => {
      const [from, to] = dayBoundsIso(date);
      return locationsApi.getTrips(childId, from, to);
    },
    enabled: !!childId && !!date,
    staleTime: date && isToday(date) ? 30_000 : 5 * 60_000,
    refetchInterval: date && isToday(date) ? 60_000 : false,
    gcTime: 60 * 60_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
}
