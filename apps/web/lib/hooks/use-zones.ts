// apps/web/lib/hooks/use-zones.ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  zonesApi,
  type Zone,
  type CreateZoneInput,
  type UpdateZoneInput,
  type ZoneChildPrefs,
  type PlaceSuggestion,
} from '@/lib/api/zones';
import {
  locationsApi,
  type FamilyLatestItem,
  type FamilyLatestParent,
  type FamilyLatestResponse,
} from '@/lib/api/locations';

const KEY = ['zones'] as const;
const SUGGESTIONS_KEY = ['zone-suggestions'] as const;

/** Пояс браузера — по нему backend считает ночь, будни и время визитов. */
function browserTz(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

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
      // Новая зона гасит подсказку места, правка круга меняет статистику.
      void qc.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
      void qc.invalidateQueries({ queryKey: ['zone-stats'] });
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
const selectItems = (d: FamilyLatestResponse | null): FamilyLatestItem[] => d?.items ?? [];

export interface FamilyMapLocations {
  items: FamilyLatestItem[];
  parents: FamilyLatestParent[];
}

const EMPTY_FAMILY_MAP: FamilyMapLocations = { items: [], parents: [] };

// Старый backend не присылает `parents` — пустой массив. Защищаемся и от мусора.
const selectFamilyMap = (d: FamilyLatestResponse | null): FamilyMapLocations => {
  if (!d) return EMPTY_FAMILY_MAP;
  return {
    items: Array.isArray(d.items) ? d.items : [],
    parents: Array.isArray(d.parents) ? d.parents : [],
  };
};

const FAMILY_LATEST_KEY = ['family-latest-locations'] as const;

/**
 * Последние точки всех детей семьи (`GET /family/locations/latest`).
 * Опрос раз в минуту, на скрытой вкладке — пауза.
 */
export function useFamilyLatestLocations() {
  return useQuery({
    queryKey: FAMILY_LATEST_KEY,
    queryFn: locationsApi.getFamilyLatest,
    select: selectItems,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 60_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * v0.70.0: общая карта семьи (кабинет, «Все») — дети и родители из того же
 * `GET /family/locations/latest` (общий кэш с картой зон). Опрос раз в 30 с,
 * на скрытой вкладке — пауза.
 */
export function useFamilyMapLocations() {
  return useQuery({
    queryKey: FAMILY_LATEST_KEY,
    queryFn: locationsApi.getFamilyLatest,
    select: selectFamilyMap,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: 1,
  });
}

/**
 * v0.67.0: подсказки мест (`GET /zones/suggestions`) — считаются по 30 дням
 * точек, меняются медленно: без опроса, свежие на 10 минут.
 */
export function useZoneSuggestions() {
  return useQuery({
    queryKey: SUGGESTIONS_KEY,
    queryFn: () => zonesApi.suggestions(browserTz()),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** «Больше не показывать» — подсказка сразу пропадает из кэша. */
export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: PlaceSuggestion) => zonesApi.dismissSuggestion(s),
    onSuccess: (_r, s) => {
      qc.setQueryData<PlaceSuggestion[]>(SUGGESTIONS_KEY, (old) =>
        old?.filter((x) => x.id !== s.id),
      );
    },
  });
}

/** v0.67.0: статистика визитов в зону за 30 дней — грузится при раскрытии карточки. */
export function useZoneStats(zoneId: string) {
  return useQuery({
    queryKey: ['zone-stats', zoneId],
    queryFn: () => zonesApi.stats(zoneId, browserTz()),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
