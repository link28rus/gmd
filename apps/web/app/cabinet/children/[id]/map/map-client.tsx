'use client';

import { useEffect, useState, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';
import { useChildren } from '@/lib/hooks/use-children';
import { useLatestLocation } from '@/lib/hooks/use-latest-location';
import { useLocationHistory } from '@/lib/hooks/use-location-history';
import { ChildMap } from '@/components/locations/child-map';
import { ChildStatusCard } from '@/components/locations/child-status-card';
import { DateSelector } from '@/components/locations/date-selector';
import { TrackTruncatedBanner } from '@/components/locations/track-truncated-banner';
import { MapErrorFallback } from '@/components/locations/map-error-fallback';
import { todayIso } from '@/lib/date/day-bounds';
import { ApiError } from '@/lib/api/client';

interface RefreshResponse {
  accessToken: string;
  user?: AuthUser;
  family?: AuthFamily;
}

interface Props {
  childId: string;
}

export default function MapClient({ childId }: Props): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAll = useAuthStore((s) => s.setAll);
  const [bootstrapping, setBootstrapping] = useState(accessToken === null);
  const [date, setDate] = useState(todayIso());
  const [mapFailed, setMapFailed] = useState(false);

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
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, router, setAll]);

  const childrenQuery = useChildren();
  const child = childrenQuery.data?.children.find((c) => c.id === childId);

  const latestQ = useLatestLocation(bootstrapping ? '' : childId);
  const { query: historyQ, isTruncated } = useLocationHistory(bootstrapping ? '' : childId, date);

  useEffect(() => {
    const err = latestQ.error ?? historyQ.error;
    if (err instanceof ApiError && err.status === 404) {
      toast.error('Ребёнок не найден');
      router.replace('/cabinet/children');
    } else if (err) {
      toast.error('Не удалось загрузить данные карты');
    }
  }, [latestQ.error, historyQ.error, router]);

  if (bootstrapping || childrenQuery.isPending) {
    return <div className="p-6 text-zinc-500">Загрузка…</div>;
  }

  if (!child) {
    return <div className="p-6 text-zinc-500">Ребёнок не найден.</div>;
  }

  const latest = latestQ.data ?? null;
  const track = historyQ.data?.items ?? [];
  const emptyState =
    latest === null && track.length === 0 && !latestQ.isPending && !historyQ.isPending;

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600">
        <Link href="/cabinet/children" className="hover:underline">
          ← Дети
        </Link>
        <span>/</span>
        <span className="font-medium text-zinc-900">{child.name}</span>
      </div>
      <DateSelector value={date} onChange={setDate} />
      {isTruncated && (
        <div className="border-b border-zinc-200 bg-white px-4 py-2">
          <TrackTruncatedBanner />
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        {emptyState ? (
          <div className="flex h-full items-center justify-center bg-zinc-50 p-6 text-center text-zinc-600">
            От устройства ребёнка ещё не приходили координаты. Убедитесь, что приложение установлено
            и открыто хотя бы раз.
          </div>
        ) : mapFailed ? (
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
        ) : (
          <>
            <ChildMap
              childId={child.id}
              childName={child.name}
              latest={latest}
              track={track}
              onMapError={() => setMapFailed(true)}
            />
            {latest && (
              <div className="absolute left-4 top-4">
                <ChildStatusCard
                  childName={child.name}
                  ageSec={latest.ageSec}
                  accuracy={latest.accuracy}
                  batteryLevel={latest.batteryLevel}
                  isCharging={latest.isCharging}
                  provider={latest.provider}
                  networkType={latest.networkType}
                  wifiSsid={latest.wifiSsid}
                  mobileOperator={latest.mobileOperator}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
