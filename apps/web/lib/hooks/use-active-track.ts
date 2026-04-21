// apps/web/lib/hooks/use-active-track.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { locationsApi, type ActiveTrackDto } from '@/lib/api/locations';

// Точки активной поездки ребёнка. Если ребёнок стоит на месте > 30 мин,
// active-track пустой — онлайн-карта очищает линии.
export function useActiveTrack(childId: string) {
  return useQuery<ActiveTrackDto>({
    queryKey: ['trips', 'active-track', childId],
    queryFn: () => locationsApi.getActiveTrack(childId),
    enabled: !!childId,
    // Тот же интервал, что у latest — чтобы карта и трек обновлялись синхронно.
    refetchInterval: 10_000,
    staleTime: 5_000,
    gcTime: 60 * 60_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
}
