// apps/web/lib/hooks/use-zones.ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zonesApi, type Zone, type CreateZoneInput, type UpdateZoneInput } from '@/lib/api/zones';
import { locationsApi, type FamilyLatestItem } from '@/lib/api/locations';

const KEY = ['zones'] as const;

export function useZones() {
  return useQuery({
    queryKey: KEY,
    queryFn: zonesApi.list,
  });
}

function useInvalidating<T, V>(fn: (v: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      // Удаление зоны уносит её события, правка — имя/цвет в ленте.
      void qc.invalidateQueries({ queryKey: ['zone-events'] });
    },
  });
}

export function useCreateZone() {
  return useInvalidating<Zone, CreateZoneInput>(zonesApi.create);
}

export function useUpdateZone() {
  return useInvalidating<Zone, { id: string; patch: UpdateZoneInput }>(({ id, patch }) =>
    zonesApi.update(id, patch),
  );
}

export function useDeleteZone() {
  return useInvalidating<void, string>(zonesApi.remove);
}

// Вне компонента — стабильная ссылка, select не пересчитывается на каждом рендере.
const selectItems = (d: { items: FamilyLatestItem[] } | null): FamilyLatestItem[] => d?.items ?? [];

/**
 * Последние точки всех детей семьи (`GET /family/locations/latest`).
 * Опрос раз в минуту, на скрытой вкладке — пауза.
 */
export function useFamilyLatestLocations() {
  return useQuery({
    queryKey: ['family-latest-locations'],
    queryFn: locationsApi.getFamilyLatest,
    select: selectItems,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 60_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
  });
}
