'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Menu } from 'lucide-react';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';
import { useChildren } from '@/lib/hooks/use-children';
import { apiFetch } from '@/lib/api/client';
import { useLatestLocation } from '@/lib/hooks/use-latest-location';
import { useActiveTrack } from '@/lib/hooks/use-active-track';
import { ChildrenSidebar } from '@/components/cabinet/children-sidebar';
import { ChildActions } from '@/components/cabinet/child-actions';
import { ChildNotAttachedView } from '@/components/cabinet/child-not-attached-view';
import { ChildMap } from '@/components/locations/child-map';
import { ChildStatusCard } from '@/components/locations/child-status-card';
import { MapErrorFallback } from '@/components/locations/map-error-fallback';
import { ApiError } from '@/lib/api/client';
import type { Child } from '@/lib/api/children';
import type { LocationDto } from '@/lib/api/locations';

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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Heartbeat: пока вкладка кабинета открыта и активна, дёргаем POST /me/seen
  // раз в 2 мин, чтобы админы в /admin/users видели «Последний заход» в
  // реальном времени. Backend сам троттлит до 1 записи в минуту на юзера.
  useEffect(() => {
    let cancelled = false;
    const ping = (): void => {
      if (cancelled || document.hidden) return;
      void apiFetch('/api/me/seen', { method: 'POST' }).catch(() => {
        /* heartbeat — best effort, игнорируем ошибки */
      });
    };
    ping();
    const id = window.setInterval(ping, 120_000);
    const onVisible = (): void => {
      if (!document.hidden) ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

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
      <ChildrenSidebar
        children={kids}
        selectedId={selectedId}
        onSelect={selectChild}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      <div className="relative flex-1 overflow-hidden">
        {/* Mobile-only: floating trigger для drawer с детьми. Круглая кнопка
            в левом-верхнем углу поверх карты — большой touch-target (44px). */}
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Открыть список детей"
          className="absolute left-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-md hover:bg-zinc-50 md:hidden"
        >
          <Menu className="h-5 w-5 text-zinc-700" />
          {selected && (
            <span
              className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white"
              style={{ backgroundColor: 'currentColor' }}
              aria-hidden="true"
            />
          )}
        </button>
        {selected ? (
          hasActiveDevice(selected) ? (
            <MapArea child={selected} />
          ) : (
            <ChildNotAttachedView child={selected} />
          )
        ) : (
          <div className="flex h-full items-center justify-center bg-zinc-50 p-6 text-center text-zinc-600">
            <div>
              <p className="mb-4">Добавьте первого ребёнка, чтобы увидеть карту.</p>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white md:hidden"
              >
                Открыть меню
              </button>
            </div>
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
  const [mapFailed, setMapFailed] = useState(false);
  const latestQ = useLatestLocation(child.id);
  const activeQ = useActiveTrack(child.id);

  useEffect(() => {
    const err = latestQ.error ?? activeQ.error;
    if (err instanceof ApiError && err.status === 404) {
      toast.error('Ребёнок не найден');
      router.replace('/cabinet');
    } else if (err) {
      toast.error('Не удалось загрузить данные карты');
    }
  }, [latestQ.error, activeQ.error, router]);

  const latest = latestQ.data ?? null;
  // Треком рисуем только точки активной поездки (от последней остановки до
  // сейчас). Если ребёнок стоит > 30 мин — активной поездки нет → track пустой
  // → линии пропадают с онлайн-карты. Прошлые поездки — в /history.
  const track: LocationDto[] = (activeQ.data?.points ?? []).map((p) => ({
    lat: p.lat,
    lon: p.lon,
    recordedAt: p.recordedAt,
    accuracy: null,
    speed: null,
  }));
  const emptyState =
    latest === null && track.length === 0 && !latestQ.isPending && !activeQ.isPending;

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
      <ChildMap
        childId={child.id}
        childName={child.name}
        latest={latest}
        track={track}
        onMapError={() => setMapFailed(true)}
      />
      {latest && (
        <div className="absolute inset-x-3 bottom-3 z-10 md:inset-x-auto md:bottom-auto md:left-4 md:top-4">
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
            actions={<ChildActions child={child} showReset={true} />}
          />
        </div>
      )}
    </>
  );
}
