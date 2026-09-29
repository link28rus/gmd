// apps/web/app/cabinet/zones/zones-client.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { useFamilyLatestLocations, useZones } from '@/lib/hooks/use-zones';
import { useChildren } from '@/lib/hooks/use-children';
import { refreshAccessToken } from '@/lib/auth/refresh-singleflight';
import { MAX_ZONES, zoneErrorMessage, type Zone } from '@/lib/api/zones';
import type { FamilyLatestItem } from '@/lib/api/locations';
import { ZonesList } from './components/zones-list';
import { ZonesMap } from './components/zones-map';
import type { MapViewState } from './components/zones-map-inner';
import { ZoneEditorDialog } from './components/zone-editor-dialog';
import { ZoneEventsFeed } from './components/zone-events-feed';
import { DeleteZoneDialog } from './components/delete-zone-dialog';
import { KidsPanel } from './components/kids-panel';
import { SHOW_ZONES_STORAGE_KEY } from './components/zone-format';

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
        const data = await refreshAccessToken();
        if (cancelled) return;
        if (!data || !data.user || !data.family) {
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

interface EditorState {
  zone: Zone | null;
  center?: { lat: number; lon: number };
  zoom?: number;
  childId?: string;
}

/** Масштаб редактора для новой зоны: не мельче квартала, не крупнее дома. */
function editorZoom(mapZoom: number | undefined): number {
  if (mapZoom === undefined) return 15;
  return Math.min(17, Math.max(14, Math.round(mapZoom)));
}

function ZonesContent(): ReactElement {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: zonesData, isLoading, isError, error, refetch } = useZones();
  const { data: childrenData } = useChildren();
  const latestQuery = useFamilyLatestLocations();
  const [selected, setSelected] = useState<string | null>(null);
  // Состояние диалогов держим и после закрытия — чтобы во время анимации
  // закрытия не мигали заголовок и форма.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ zone: null });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<Zone | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lon: number; seq: number } | null>(null);
  const [showZones, setShowZones] = useState(true);
  // Текущий вид карты — без ре-рендеров, читается только при открытии редактора.
  const viewRef = useRef<MapViewState | null>(null);

  // Тумблер «Показывать геозоны» — из localStorage после монтирования (без
  // рассинхрона гидрации).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SHOW_ZONES_STORAGE_KEY) === '0') setShowZones(false);
    } catch {
      // localStorage недоступен — остаётся «показывать»
    }
  }, []);
  const toggleShowZones = (v: boolean): void => {
    setShowZones(v);
    try {
      window.localStorage.setItem(SHOW_ZONES_STORAGE_KEY, v ? '1' : '0');
    } catch {
      // не критично
    }
  };

  const zones = useMemo(() => zonesData ?? [], [zonesData]);
  const kids = useMemo(() => childrenData?.children ?? [], [childrenData]);
  const kidOptions = useMemo(() => kids.map((k) => ({ id: k.id, name: k.name })), [kids]);
  const kidNames = useMemo(() => new Map(kids.map((k) => [k.id, k.name])), [kids]);
  const latest = useMemo(() => latestQuery.data ?? [], [latestQuery.data]);
  const limitReached = zones.length >= MAX_ZONES;

  // Выбранную зону удалили (в т.ч. с другого устройства) — снимаем выбор.
  useEffect(() => {
    if (selected && zonesData && !zonesData.some((z) => z.id === selected)) setSelected(null);
  }, [selected, zonesData]);

  const guardLimit = (): boolean => {
    if (!limitReached) return true;
    toast.error(`Достигнут лимит: в семье может быть не больше ${MAX_ZONES} зон.`);
    return false;
  };

  const openEditor = (state: EditorState): void => {
    setEditor(state);
    setEditorOpen(true);
  };

  const openCreate = (): void => {
    if (!guardLimit()) return;
    const v = viewRef.current;
    openEditor({
      zone: null,
      center: v ? { lat: v.lat, lon: v.lon } : undefined,
      zoom: editorZoom(v?.zoom),
    });
  };

  const openEdit = (zone: Zone): void => openEditor({ zone });

  const openDelete = (zone: Zone): void => {
    setDeleting(zone);
    setDeleteOpen(true);
  };

  const handleMapDblClick = (lat: number, lon: number): void => {
    if (!guardLimit()) return;
    openEditor({ zone: null, center: { lat, lon }, zoom: editorZoom(viewRef.current?.zoom) });
  };

  const handleCreateAtChild = (childId: string, lat: number, lon: number): void => {
    if (!guardLimit()) return;
    openEditor({ zone: null, center: { lat, lon }, zoom: 16, childId });
  };

  const handleFocusChild = (p: FamilyLatestItem): void => {
    setFocus((prev) => ({ lat: p.lat, lon: p.lon, seq: (prev?.seq ?? 0) + 1 }));
  };

  const handleViewChange = useCallback((v: MapViewState) => {
    viewRef.current = v;
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Геозоны</h1>
        <ShowZonesToggle checked={showZones} onChange={toggleShowZones} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}

      {isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">{zoneErrorMessage(error, 'load')}</p>
          <button
            type="button"
            className="mt-2 text-sm text-foreground underline"
            onClick={() => refetch()}
          >
            Попробовать снова
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            Совет: дважды кликните по карте — откроется создание зоны с центром в этой точке. Клик
            по ребёнку на карте — «Создать зону здесь».
          </p>
          <div className="flex flex-col gap-4 lg:h-[620px] lg:flex-row">
            <div className="flex flex-col gap-4 lg:min-h-0 lg:w-1/3">
              <KidsPanel
                kids={kids}
                zones={zones}
                latest={latest}
                latestLoading={latestQuery.isPending}
                latestError={latestQuery.isError}
                onFocus={handleFocusChild}
                onCreateAt={handleCreateAtChild}
                createDisabled={limitReached}
              />
              <div className="lg:min-h-0 lg:flex-1">
                <ZonesList
                  zones={zones}
                  kidNames={kidNames}
                  selectedId={selected}
                  onSelect={setSelected}
                  onCreate={openCreate}
                  onEdit={openEdit}
                  onDelete={openDelete}
                />
              </div>
            </div>
            <div className="h-[420px] overflow-hidden rounded-md border border-border lg:h-auto lg:flex-1">
              <ZonesMap
                zones={zones}
                kids={kids}
                latest={latest}
                latestReady={!latestQuery.isPending}
                userId={userId}
                selectedId={selected}
                onSelect={setSelected}
                showZones={showZones}
                onMapDblClick={handleMapDblClick}
                onViewChange={handleViewChange}
                onCreateAtChild={handleCreateAtChild}
                focus={focus}
              />
            </div>
          </div>
        </>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-foreground">События</h2>
        <div className="rounded-md border border-border bg-card p-4">
          <ZoneEventsFeed kids={kidOptions} zones={zones} />
        </div>
      </div>

      <ZoneEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        kids={kidOptions}
        initial={editor.zone ?? undefined}
        initialCenter={editor.center}
        initialZoom={editor.zoom}
        initialChildId={editor.childId}
        onSaved={(saved) => setSelected(saved.id)}
      />

      <DeleteZoneDialog
        open={deleteOpen}
        zone={deleting}
        onOpenChange={setDeleteOpen}
        onDeleted={(id) => {
          setSelected((cur) => (cur === id ? null : cur));
        }}
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
          'relative h-5 w-9 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          checked ? 'border-primary bg-primary' : 'border-border bg-muted',
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
