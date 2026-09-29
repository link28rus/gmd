// apps/web/lib/hooks/use-zones.ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  zonesApi,
  type Zone,
  type CreateZoneInput,
  type UpdateZoneInput,
  type ZoneChildPrefs,
} from '@/lib/api/zones';
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

const MY_PREFS_KEY = ['zones', 'my-notifications'] as const;

function patchZonePrefs(
  zones: Zone[] | undefined,
  zoneId: string,
  items: ZoneChildPrefs[],
): Zone[] | undefined {
  return zones?.map((z) => (z.id === zoneId ? { ...z, myPrefs: items } : z));
}

/**
 * Личные настройки уведомлений (`PUT /zones/:id/my-notifications`) с
 * оптимистичным обновлением кэша списка зон. Отправляется полный набор по всем
 * детям зоны — быстрые переключения подряд не затирают друг друга.
 */
export function useSetMyNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: MY_PREFS_KEY,
    mutationFn: ({ zoneId, items }: { zoneId: string; items: ZoneChildPrefs[] }) =>
      zonesApi.setMyNotifications(zoneId, items),
    onMutate: async ({ zoneId, items }) => {
      await qc.cancelQueries({ queryKey: KEY, exact: true });
      const previous = qc.getQueryData<Zone[]>(KEY);
      qc.setQueryData<Zone[]>(KEY, (old) => patchZonePrefs(old, zoneId, items));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
    },
    onSuccess: (res, { zoneId }) => {
      // Ответ последнего запроса — итоговое состояние; промежуточные не применяем.
      if (qc.isMutating({ mutationKey: MY_PREFS_KEY }) === 1) {
        qc.setQueryData<Zone[]>(KEY, (old) => patchZonePrefs(old, zoneId, res.items));
      }
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: MY_PREFS_KEY }) === 1) {
        void qc.invalidateQueries({ queryKey: KEY, exact: true });
      }
    },
  });
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
