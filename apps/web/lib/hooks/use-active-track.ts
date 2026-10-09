// apps/web/lib/hooks/use-active-track.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { locationsApi, type ActiveTrackDto } from '@/lib/api/locations';
import { useTrackView } from './use-track-view';

// Точки активной поездки ребёнка. Если ребёнок стоит на месте > 30 мин,
// active-track пустой — онлайн-карта очищает линии.
// v0.80.0: вид трека (по дорогам / как записано) — часть ключа: при
// переключении сразу перезапрос, прежний трек виден до ответа.
export function useActiveTrack(childId: string) {
  const [view] = useTrackView();
  return useQuery<ActiveTrackDto>({
    queryKey: ['trips', 'active-track', childId, view],
    queryFn: () => locationsApi.getActiveTrack(childId, view),
    enabled: !!childId,
    // Тот же интервал, что у latest — чтобы карта и трек обновлялись синхронно.
    refetchInterval: 10_000,
    staleTime: 5_000,
    gcTime: 60 * 60_000,
    placeholderData: (prev) => prev,
    retry: 1,
  });
}
