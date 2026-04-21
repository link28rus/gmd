'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';
import { useChildren } from '@/lib/hooks/use-children';
import { useLatestLocation } from '@/lib/hooks/use-latest-location';
import { useLocationHistory } from '@/lib/hooks/use-location-history';
import { ChildrenSidebar } from '@/components/cabinet/children-sidebar';
import { ChildActions } from '@/components/cabinet/child-actions';
import { ChildNotAttachedView } from '@/components/cabinet/child-not-attached-view';
import { ChildMap } from '@/components/locations/child-map';
import { ChildStatusCard } from '@/components/locations/child-status-card';
import { MapErrorFallback } from '@/components/locations/map-error-fallback';
import { TrackTruncatedBanner } from '@/components/locations/track-truncated-banner';
import { todayIso } from '@/lib/date/day-bounds';
import { ApiError } from '@/lib/api/client';
import type { Child } from '@/lib/api/children';

interface RefreshResponse {
  accessToken: string;
  user?: AuthUser;
  family?: AuthFamily;
  requiresConsent?: boolean;
}

export default function CabinetClient(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAll = useAuthStore((s) => s.setAll);
  const setConsent = useAuthStore((s) => s.setConsent);
  const [bootstrapping, setBootstrapping] = useState(accessToken === null);

  useEffect(() => {
    if (accessToken !== null) {
      setBootstrapping(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST' });
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const data = (await res.json()) as RefreshResponse;
        if (cancelled) return;
        if (!data.user || !data.family) {
          router.replace('/login');
          return;
        }
        setAll({ accessToken: data.accessToken, user: data.user, family: data.family });
        setConsent(data.requiresConsent ?? false);
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootstrapping) {
    return (
      <div className="flex h-[calc(100vh-49px)] items-center justify-center">
        <p className="text-sm text-zinc-500">Загружаем…</p>
      </div>
    );
  }

  return <CabinetHome initialChildId={searchParams.get('childId')} />;
}

function CabinetHome({ initialChildId }: { initialChildId: string | null }): ReactElement {
  const router = useRouter();
  const childrenQ = useChildren();
  const [selectedId, setSelectedId] = useState<string | null>(initialChildId);

  // Если ничего не выбрано — выбираем первого ребёнка автоматически.
  useEffect(() => {
    if (selectedId) return;
    const first = childrenQ.data?.children[0]?.id;
    if (first) setSelectedId(first);
  }, [childrenQ.data, selectedId]);

  function selectChild(id: string): void {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('childId', id);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
  }

  const kids = childrenQ.data?.children ?? [];
  const selected = kids.find((c) => c.id === selectedId) ?? null;

  if (childrenQ.isPending) {
    return (
      <div className="flex h-[calc(100vh-49px)] items-center justify-center">
        <p className="text-sm text-zinc-500">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-49px)]">
      <ChildrenSidebar children={kids} selectedId={selectedId} onSelect={selectChild} />
      <div className="relative flex-1 overflow-hidden">
        {selected ? (
          hasActiveDevice(selected) ? (
            <MapArea child={selected} />
          ) : (
            <ChildNotAttachedView child={selected} />
          )
        ) : (
          <div className="flex h-full items-center justify-center bg-zinc-50 p-6 text-center text-zinc-600">
            Добавьте первого ребёнка в меню слева, чтобы увидеть карту.
          </div>
        )}
      </div>
    </div>
  );
}

function hasActiveDevice(c: Child): boolean {
  return c.device !== null && c.device.revokedAt === null;
}

function MapArea({ child }: { child: Child }): ReactElement {
  const router = useRouter();
  const [date] = useState(todayIso());
  const [mapFailed, setMapFailed] = useState(false);
  const latestQ = useLatestLocation(child.id);
  const { query: historyQ, isTruncated } = useLocationHistory(child.id, date);

  useEffect(() => {
    const err = latestQ.error ?? historyQ.error;
    if (err instanceof ApiError && err.status === 404) {
      toast.error('Ребёнок не найден');
      router.replace('/cabinet');
    } else if (err) {
      toast.error('Не удалось загрузить данные карты');
    }
  }, [latestQ.error, historyQ.error, router]);

  const latest = latestQ.data ?? null;
  const track = historyQ.data?.items ?? [];
  const emptyState =
    latest === null && track.length === 0 && !latestQ.isPending && !historyQ.isPending;

  if (emptyState) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-50 p-6 text-center text-zinc-600">
        От устройства ребёнка ещё не приходили координаты. Убедитесь, что приложение установлено и
        открыто хотя бы раз.
      </div>
    );
  }

  if (mapFailed) {
    return (
      <MapErrorFallback
        latest={
          latest
            ? {
                lat: latest.lat,
                lon: latest.lon,
                accuracy: latest.accuracy,
                recordedAt: latest.recordedAt,
              }
            : null
        }
      />
    );
  }

  return (
    <>
      {isTruncated && (
        <div className="absolute left-4 right-4 top-4 z-10">
          <TrackTruncatedBanner />
        </div>
      )}
      <ChildMap
        childName={child.name}
        latest={latest}
        track={track}
        onMapError={() => setMapFailed(true)}
      />
      {latest && (
        <div className="absolute left-4 top-4 z-10">
          <ChildStatusCard
            childName={child.name}
            ageSec={latest.ageSec}
            accuracy={latest.accuracy}
            batteryLevel={latest.batteryLevel}
            isCharging={latest.isCharging}
            provider={latest.provider}
            actions={<ChildActions child={child} showReset={true} />}
          />
        </div>
      )}
    </>
  );
}
