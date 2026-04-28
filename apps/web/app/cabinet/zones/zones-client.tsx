// apps/web/app/cabinet/zones/zones-client.tsx
'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';
import { useZones } from '@/lib/hooks/use-zones';
import { useChildren } from '@/lib/hooks/use-children';
import { ZonesList } from './components/zones-list';
import { ZonesMap } from './components/zones-map';
import { ZoneEditorDialog } from './components/zone-editor-dialog';
import { ZoneEventsFeed } from './components/zone-events-feed';
import type { Zone } from '@/lib/api/zones';

interface RefreshResponse {
  accessToken: string;
  user?: AuthUser;
  family?: AuthFamily;
}

export default function ZonesClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAll = useAuthStore((s) => s.setAll);
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
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </div>
    );
  }

  return <ZonesContent />;
}

function ZonesContent(): ReactElement {
  const { data: zones, isLoading, isError, error, refetch } = useZones();
  const { data: childrenData } = useChildren();
  const [selected, setSelected] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [pendingCenter, setPendingCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [showZones, setShowZones] = useState(true);

  // childrenApi.list returns { children: Child[] }
  const kids =
    (childrenData as { children: Array<{ id: string; name: string }> } | undefined)?.children ?? [];

  const openCreate = () => {
    setEditingZone(null);
    setPendingCenter(null);
    setEditorOpen(true);
  };

  const openEdit = (zone: Zone) => {
    setEditingZone(zone);
    setPendingCenter(null);
    setEditorOpen(true);
  };

  const handleMapDblClick = (lat: number, lon: number) => {
    setEditingZone(null);
    setPendingCenter({ lat, lon });
    setEditorOpen(true);
  };

  const handleSaved = (saved: Zone) => {
    // useCreateZone / useUpdateZone already invalidate the zones query,
    // so we just update the selected id to the saved zone.
    setSelected(saved.id);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Геозоны</h1>
        <ShowZonesToggle checked={showZones} onChange={setShowZones} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}

      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            Не удалось загрузить зоны: {error instanceof Error ? error.message : 'ошибка'}
          </p>
          <button className="mt-2 text-sm underline" onClick={() => refetch()}>
            Попробовать снова
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            Совет: дважды кликните по зданию на карте — откроется быстрое создание новой зоны с
            готовым центром.
          </p>
          <div className="flex flex-col gap-4 lg:flex-row" style={{ minHeight: '500px' }}>
            <div className="lg:w-1/3">
              <ZonesList
                zones={zones ?? []}
                selectedId={selected}
                onSelect={setSelected}
                onCreate={openCreate}
                onEdit={openEdit}
              />
            </div>
            <div className="overflow-hidden rounded-md border lg:flex-1">
              <ZonesMap
                zones={zones ?? []}
                selectedId={selected}
                onSelect={setSelected}
                showZones={showZones}
                onMapDblClick={handleMapDblClick}
              />
            </div>
          </div>
        </>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-foreground">Последние события</h2>
        <div className="rounded-md border border-border bg-card p-4">
          <ZoneEventsFeed />
        </div>
      </div>

      <ZoneEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        kids={kids}
        initial={editingZone ?? undefined}
        initialCenter={pendingCenter ?? undefined}
        onSaved={handleSaved}
      />
    </div>
  );
}

interface ShowZonesToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ShowZonesToggle({ checked, onChange }: ShowZonesToggleProps): ReactElement {
  return (
    <label className="inline-flex select-none items-center gap-2 text-sm text-muted-foreground">
      <span>Показывать геозоны на карте</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-5 w-9 rounded-full border transition-colors',
          checked ? 'bg-primary border-primary' : 'bg-muted border-border',
        ].join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
    </label>
  );
}
