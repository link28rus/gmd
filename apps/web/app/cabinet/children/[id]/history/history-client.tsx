'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { locationsApi } from '@/lib/api/locations';
import type { Zone } from '@/lib/api/zones';
import { reverseGeocode, reverseKey } from '@/lib/api/geocode';
import { useChildren } from '@/lib/hooks/use-children';
import { useZones } from '@/lib/hooks/use-zones';
import { useTrackView } from '@/lib/hooks/use-track-view';
import { ZONE_ICON_EMOJI } from '@/app/cabinet/zones/components/zone-format';
import {
  avgSpeedKmh,
  dayTitle,
  fmtClock,
  fmtDistance,
  fmtDurationMs,
  groupTripsByDay,
  pluralRu,
  ribbonSpan,
  tripEndMs,
  zoneAt,
  type DayTrip,
  type TripDay,
} from '@/lib/history/trip-history';
import { HistoryMap } from './history-map';
import type { TripTrack } from './history-map-inner';

const RIBBON_HOURS = [6, 12, 18];

type TripPointsData = Awaited<ReturnType<typeof locationsApi.getTripPoints>>;

export default function HistoryClient({ childId }: { childId: string }): ReactElement {
  const tripsQ = useQuery({
    queryKey: ['trips', 'list', childId],
    queryFn: () => locationsApi.getTrips(childId),
    staleTime: 30_000,
    // Пока поездка идёт, список обновляем — она растёт на глазах.
    refetchInterval: (q) => (q.state.data?.trips.some((t) => t.isActive) ? 60_000 : false),
  });
  const childrenQ = useChildren();
  const zonesQ = useZones();

  const child = childrenQ.data?.children.find((c) => c.id === childId);
  // Не через zonesForChild из child-zones-layer: тот тянет leaflet, а он
  // падает при SSR (window is not defined). null — зоны ещё грузятся.
  const zones = useMemo(
    () =>
      zonesQ.data
        ? zonesQ.data.filter((z) => z.allChildren || z.childIds.includes(childId))
        : zonesQ.isError
          ? []
          : null,
    [zonesQ.data, zonesQ.isError, childId],
  );
  const days = useMemo(() => groupTripsByDay(tripsQ.data?.trips ?? []), [tripsQ.data]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const day = days.find((d) => d.key === dayKey) ?? days[0] ?? null;
  const selected = day?.trips.find((t) => t.trip.id === selectedId) ?? null;

  // v0.80.0: вид трека (по дорогам / как записано) — часть ключа. При
  // переключении прежние точки той же поездки видны до ответа; чужие
  // (useQueries сопоставляет запросы по индексу) не подставляем.
  const [trackView] = useTrackView();
  const trackQs = useQueries({
    queries: (day?.trips ?? []).map(({ trip }) => ({
      queryKey: ['trips', 'points', childId, trip.id, trackView],
      queryFn: () => locationsApi.getTripPoints(childId, trip.id, trackView),
      staleTime: trip.isActive ? 20_000 : 5 * 60_000,
      refetchInterval: trip.isActive ? 30_000 : (false as const),
      placeholderData: (
        prev: TripPointsData | undefined,
        prevQuery: { queryKey: readonly unknown[] } | undefined,
      ) => (prevQuery?.queryKey[3] === trip.id ? prev : undefined),
    })),
  });
  const tracks = useMemo(() => {
    const out: Record<string, TripTrack | undefined> = {};
    (day?.trips ?? []).forEach(({ trip }, i) => {
      const data = trackQs[i]?.data;
      if (data) out[trip.id] = { points: data.points, stays: data.stays ?? [] };
    });
    return out;
  }, [day, trackQs]);

  // Esc снимает выделение поездки — карта возвращается ко всему дню.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pickDay = (key: string): void => {
    setDayKey(key);
    setSelectedId(null);
  };
  const pickTrip = (d: TripDay, tripId: string): void => {
    setDayKey(d.key);
    setSelectedId((cur) => (cur === tripId && d.key === day?.key ? null : tripId));
  };

  return (
    <div className="flex h-[calc(100vh-49px)] flex-col md:flex-row">
      <aside className="order-2 flex min-h-0 flex-1 flex-col border-t border-border bg-card md:order-1 md:w-[400px] md:flex-none md:border-r md:border-t-0">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Link
            href="/cabinet"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Назад к карте"
            aria-label="Назад к карте"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-foreground">
              История передвижений
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {child ? `${child.name} · ` : ''}последние 30 дней
            </p>
          </div>
        </header>

        <div data-trip-list className="min-h-0 flex-1 overflow-y-auto">
          {tripsQ.isPending ? (
            <ListSkeleton />
          ) : tripsQ.isError ? (
            <div className="space-y-3 px-4 py-6 text-sm text-muted-foreground">
              <p>Не удалось загрузить историю поездок.</p>
              <button
                type="button"
                onClick={() => void tripsQ.refetch()}
                className="rounded-md border border-border px-3 py-1.5 text-foreground hover:bg-muted"
              >
                Повторить
              </button>
            </div>
          ) : days.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              За последние 30 дней поездок нет. Поездка появится здесь, когда ребёнок начнёт
              двигаться и отойдёт от места, где был.
            </p>
          ) : (
            days.map((d) => (
              <DaySection
                key={d.key}
                day={d}
                active={d.key === day?.key}
                selectedId={d.key === day?.key ? selectedId : null}
                zones={zones}
                onPickDay={() => pickDay(d.key)}
                onPickTrip={(id) => pickTrip(d, id)}
              />
            ))
          )}
        </div>
      </aside>

      <section className="relative order-1 h-[42vh] shrink-0 overflow-hidden bg-muted md:order-2 md:h-auto md:flex-1">
        {day ? (
          <>
            <HistoryMap
              dayKey={day.key}
              trips={day.trips}
              tracks={tracks}
              selectedId={selectedId}
              onSelect={(id) => pickTrip(day, id)}
              zones={zones ?? []}
            />
            <MapCard
              day={day}
              selected={selected}
              track={selected ? tracks[selected.trip.id] : undefined}
              zones={zones}
              onClear={() => setSelectedId(null)}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {tripsQ.isPending ? 'Загружаем поездки…' : 'Маршрутов за этот период нет.'}
          </div>
        )}
      </section>
    </div>
  );
}

function DaySection({
  day,
  active,
  selectedId,
  zones,
  onPickDay,
  onPickTrip,
}: {
  day: TripDay;
  active: boolean;
  selectedId: string | null;
  zones: Zone[] | null;
  onPickDay: () => void;
  onPickTrip: (tripId: string) => void;
}): ReactElement {
  const t = dayTitle(day.date);
  const n = day.trips.length;
  return (
    <section aria-label={`${t.title}, ${t.date}`} className="border-b border-border">
      <div
        className={`sticky top-0 z-10 border-b border-border px-4 pb-3 pt-3 backdrop-blur ${
          active ? 'bg-muted/95' : 'bg-card/95'
        }`}
      >
        <button
          type="button"
          onClick={onPickDay}
          aria-pressed={active && selectedId === null}
          className="flex w-full items-baseline justify-between gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 truncate">
            <span className="text-sm font-semibold text-foreground">{t.title}</span>
            <span className="ml-2 text-xs text-muted-foreground">{t.date}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {n} {pluralRu(n, 'поездка', 'поездки', 'поездок')} · {fmtDistance(day.distanceM)} ·{' '}
            {fmtDurationMs(day.movingMs)}
          </span>
        </button>
        <DayRibbon day={day} selectedId={selectedId} onPickTrip={onPickTrip} />
      </div>

      <ol className="px-2 py-2">
        {day.trips.map((item, i) => {
          const next = day.trips[i + 1];
          return (
            <li key={item.trip.id}>
              <TripRow
                item={item}
                selected={item.trip.id === selectedId}
                zones={zones}
                onClick={() => onPickTrip(item.trip.id)}
              />
              {next && item.trip.endedAt && (
                <StayGap fromIso={item.trip.endedAt} toIso={next.trip.startedAt} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Лента суток 0–24 ч: когда ребёнок был в пути. */
function DayRibbon({
  day,
  selectedId,
  onPickTrip,
}: {
  day: TripDay;
  selectedId: string | null;
  onPickTrip: (tripId: string) => void;
}): ReactElement {
  const now = Date.now();
  const nowFrac = (now - day.date.getTime()) / 86_400_000;
  return (
    <div className="mt-2.5">
      <div className="relative h-5 rounded-md bg-foreground/10">
        {RIBBON_HOURS.map((h) => (
          <span
            key={h}
            aria-hidden
            className="absolute inset-y-1 w-px bg-border"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        {nowFrac > 0 && nowFrac < 1 && (
          <span
            aria-hidden
            title="Сейчас"
            className="absolute -inset-y-0.5 w-0.5 rounded bg-foreground/60"
            style={{ left: `${nowFrac * 100}%` }}
          />
        )}
        {day.trips.map((item) => {
          const span = ribbonSpan(item.trip, day.date, now);
          const isSel = item.trip.id === selectedId;
          const dim = selectedId !== null && !isSel;
          return (
            <button
              key={item.trip.id}
              type="button"
              onClick={() => onPickTrip(item.trip.id)}
              title={`Поездка ${item.ordinal}: ${fmtClock(item.trip.startedAt)}–${
                item.trip.endedAt ? fmtClock(item.trip.endedAt) : 'сейчас'
              }`}
              aria-label={`Поездка ${item.ordinal}`}
              className={`absolute rounded-sm transition-[opacity,top,bottom] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isSel ? '-inset-y-1 ring-2 ring-card' : 'inset-y-1'
              }`}
              style={{
                left: `${span.left * 100}%`,
                width: `max(4px, ${span.width * 100}%)`,
                background: item.color,
                opacity: dim ? 0.35 : 1,
              }}
            />
          );
        })}
      </div>
      <div
        aria-hidden
        className="relative mt-1 h-3 text-[10px] tabular-nums leading-3 text-muted-foreground"
      >
        <span className="absolute left-0">0</span>
        {RIBBON_HOURS.map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {h}
          </span>
        ))}
        <span className="absolute right-0">24</span>
      </div>
    </div>
  );
}

function TripRow({
  item,
  selected,
  zones,
  onClick,
}: {
  item: DayTrip;
  selected: boolean;
  zones: Zone[] | null;
  onClick: () => void;
}): ReactElement {
  const ref = useRef<HTMLButtonElement>(null);
  const visible = useInView(ref);
  const { trip } = item;
  const durationMs = tripEndMs(trip) - new Date(trip.startedAt).getTime();
  const speed = avgSpeedKmh(trip.distanceM, durationMs);

  // Выбор на карте — докручиваем список до строки. Не scrollIntoView: он
  // прокручивает и окно, и шапка кабинета уезжает.
  useEffect(() => {
    const el = ref.current;
    const box = el?.closest<HTMLElement>('[data-trip-list]');
    if (!selected || !el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const stickyH = 96; // шапка дня с лентой
    if (r.top < b.top + stickyH) box.scrollBy({ top: r.top - b.top - stickyH, behavior: 'smooth' });
    else if (r.bottom > b.bottom)
      box.scrollBy({ top: r.bottom - b.bottom + 8, behavior: 'smooth' });
  }, [selected]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group flex w-full gap-3 rounded-lg px-2 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? 'bg-muted' : 'hover:bg-muted/60'
      }`}
      style={selected ? { boxShadow: `inset 3px 0 0 ${item.color}` } : undefined}
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums text-white"
        style={{ background: item.color }}
      >
        {item.ordinal}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-semibold tabular-nums text-foreground">
            {fmtClock(trip.startedAt)} – {trip.endedAt ? fmtClock(trip.endedAt) : 'сейчас'}
          </span>
          {trip.isActive ? (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 [html[data-admin-theme='dim']_&]:text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />В пути
            </span>
          ) : (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {fmtDurationMs(durationMs)}
            </span>
          )}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-foreground/90">
          <Place lat={trip.startLat} lon={trip.startLon} zones={zones} enabled={visible} />
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Place lat={trip.endLat} lon={trip.endLon} zones={zones} enabled={visible} />
        </span>
        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
          {fmtDistance(trip.distanceM)}
          {speed !== null && ` · ${speed} км/ч в среднем`}
        </span>
      </span>
    </button>
  );
}

/** Между поездками — сколько ребёнок пробыл на месте. */
function StayGap({ fromIso, toIso }: { fromIso: string; toIso: string }): ReactElement | null {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (ms < 60_000) return null;
  return (
    <div className="flex items-center gap-3 py-0.5 pl-[19px] text-xs text-muted-foreground">
      <span aria-hidden className="h-4 border-l border-dashed border-border" />
      <span>{fmtDurationMs(ms)} на месте</span>
    </div>
  );
}

/** Подпись места: геозона ребёнка, иначе адрес ближайшего дома. */
function Place({
  lat,
  lon,
  zones,
  enabled,
}: {
  lat: number;
  lon: number;
  /** null — зоны ещё грузятся: адрес не запрашиваем, точка может оказаться в зоне. */
  zones: Zone[] | null;
  enabled: boolean;
}): ReactElement {
  const zone = zones ? zoneAt(zones, lat, lon) : null;
  const addrQ = useQuery({
    queryKey: ['geocode', 'reverse', reverseKey(lat, lon)],
    queryFn: () => reverseGeocode(lat, lon),
    enabled: enabled && zones !== null && !zone,
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  if (zone) {
    return (
      <span className="min-w-0 truncate font-medium" title={zone.name}>
        <span aria-hidden className="mr-1">
          {ZONE_ICON_EMOJI[zone.icon] ?? '📍'}
        </span>
        {zone.name}
      </span>
    );
  }
  if (addrQ.data) {
    return (
      <span className="min-w-0 truncate" title={`${addrQ.data.name}, ${addrQ.data.description}`}>
        {addrQ.data.name}
      </span>
    );
  }
  if (addrQ.isError || addrQ.data === null) {
    return <span className="min-w-0 truncate text-muted-foreground">точка на карте</span>;
  }
  return (
    <span aria-label="Адрес загружается" className="h-3.5 w-24 animate-pulse rounded bg-muted" />
  );
}

/** Плашка поверх карты: сводка дня или подробности выбранной поездки. */
function MapCard({
  day,
  selected,
  track,
  zones,
  onClear,
}: {
  day: TripDay;
  selected: DayTrip | null;
  track: TripTrack | undefined;
  zones: Zone[] | null;
  onClear: () => void;
}): ReactElement {
  const t = dayTitle(day.date);
  const base =
    'absolute left-3 top-3 z-[1000] w-[min(320px,calc(100%-72px))] rounded-xl border border-border bg-card/95 p-3 text-card-foreground shadow-lg backdrop-blur';

  if (!selected) {
    const n = day.trips.length;
    return (
      <div className={base}>
        <p className="text-sm font-semibold">
          {t.title}, {t.date}
        </p>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <Stat label={pluralRu(n, 'поездка', 'поездки', 'поездок')} value={String(n)} />
          <Stat label="в пути" value={fmtDurationMs(day.movingMs)} />
          <Stat label="путь" value={fmtDistance(day.distanceM)} />
        </dl>
        <p className="mt-2 hidden text-xs text-muted-foreground md:block">
          Нажмите на маршрут или поездку в списке, чтобы выделить её.
        </p>
      </div>
    );
  }

  const { trip } = selected;
  const durationMs = tripEndMs(trip) - new Date(trip.startedAt).getTime();
  const speed = avgSpeedKmh(trip.distanceM, durationMs);
  const stays = track?.stays.length ?? 0;
  return (
    <div className={base}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: selected.color }}
          />
          Поездка {selected.ordinal} · {t.title.toLowerCase()}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Показать весь день (Esc)"
        >
          Весь день
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ol className="mt-2 space-y-1 text-sm">
        <li className="flex min-w-0 items-center gap-2">
          <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
            {fmtClock(trip.startedAt)}
          </span>
          <Place lat={trip.startLat} lon={trip.startLon} zones={zones} enabled />
        </li>
        <li className="flex min-w-0 items-center gap-2">
          <span className="w-11 shrink-0 tabular-nums text-muted-foreground">
            {trip.endedAt ? fmtClock(trip.endedAt) : 'сейчас'}
          </span>
          <Place lat={trip.endLat} lon={trip.endLon} zones={zones} enabled />
        </li>
      </ol>
      <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-border pt-2">
        <Stat label="в пути" value={fmtDurationMs(durationMs)} />
        <Stat label="путь" value={fmtDistance(trip.distanceM)} />
        <Stat label="ср. скорость" value={speed !== null ? `${speed} км/ч` : '—'} />
      </dl>
      {stays > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {stays} {pluralRu(stays, 'остановка', 'остановки', 'остановок')} в пути — отмечены «П» на
          карте
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0">
      <dd className="truncate text-base font-semibold tabular-nums">{value}</dd>
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
    </div>
  );
}

function ListSkeleton(): ReactElement {
  return (
    <div className="space-y-4 px-4 py-4" aria-label="Загрузка">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-5 w-full animate-pulse rounded bg-muted" />
          <div className="h-14 w-full animate-pulse rounded bg-muted/70" />
        </div>
      ))}
    </div>
  );
}

/** true, как только элемент хоть раз оказался рядом с видимой областью списка. */
function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: '200px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}
