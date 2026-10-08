'use client';

import { useMemo, type ReactElement } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { useZones, useFamilyMapLocations } from '@/lib/hooks/use-zones';
import type { Child } from '@/lib/api/children';
import { ZonesMap } from '@/app/cabinet/zones/components/zones-map';

interface Props {
  kids: Child[];
  /** Клик по метке ребёнка — переход к нему (`?childId=<id>`). */
  onSelectChild: (id: string) => void;
}

/**
 * v0.70.0: общая карта семьи (`?childId=all`) — дети, родители, геозоны.
 * Только просмотр: та же карта, что на странице зон, без редакторских частей.
 * Опрос `GET /family/locations/latest` раз в 30 с.
 */
export function FamilyMapView({ kids, onSelectChild }: Props): ReactElement {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const zonesQ = useZones();
  const latestQ = useFamilyMapLocations();

  const zones = useMemo(() => zonesQ.data ?? [], [zonesQ.data]);
  const mapKids = useMemo(
    () => kids.map((k) => ({ id: k.id, name: k.name, avatarKey: k.avatarKey })),
    [kids],
  );
  const items = useMemo(() => latestQ.data?.items ?? [], [latestQ.data]);
  const parents = useMemo(() => latestQ.data?.parents ?? [], [latestQ.data]);

  // Привязанные дети, от которых ещё не было ни одной точки.
  const withoutPoints = useMemo(() => {
    if (latestQ.isPending || latestQ.isError) return [];
    const has = new Set(items.map((p) => p.childId));
    return kids.filter((k) => k.device && k.device.revokedAt === null && !has.has(k.id));
  }, [kids, items, latestQ.isPending, latestQ.isError]);

  // Стартовый вид карты считается при монтировании по зонам — ждём их.
  if (zonesQ.isPending) {
    return <div className="h-full w-full animate-pulse bg-muted" />;
  }

  return (
    <>
      <ZonesMap
        zones={zones}
        kids={mapKids}
        latest={items}
        latestReady={!latestQ.isPending}
        userId={userId}
        parents={parents}
        onKidClick={onSelectChild}
      />
      {(latestQ.isError || withoutPoints.length > 0) && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center md:inset-x-auto md:left-4">
          <div className="pointer-events-auto rounded-md border border-border bg-card/95 px-3 py-2 text-xs text-muted-foreground shadow-md">
            {latestQ.isError
              ? 'Не удалось загрузить точки семьи — повторим через 30 секунд.'
              : `Пока нет координат: ${withoutPoints.map((k) => k.name).join(', ')}`}
          </div>
        </div>
      )}
    </>
  );
}
