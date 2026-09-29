// apps/web/app/cabinet/zones/components/zone-events-feed.tsx
'use client';

import { useId, useMemo, useState, type ReactElement } from 'react';
import { TriangleAlert, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Zone, ZoneEvent } from '@/lib/api/zones';
import { useZoneEvents } from '@/lib/hooks/use-zone-events';
import {
  ZONE_ICON_EMOJI,
  dayLabel,
  formatClock,
  formatDuration,
  localDayKey,
  minutesToHHMM,
} from './zone-format';

interface Props {
  kids: Array<{ id: string; name: string }>;
  zones: Zone[];
}

interface DayGroup {
  key: string;
  label: string;
  items: ZoneEvent[];
}

function groupByDay(events: ZoneEvent[]): DayGroup[] {
  const now = new Date();
  const groups: DayGroup[] = [];
  for (const e of events) {
    const d = new Date(e.recordedAt);
    const key = localDayKey(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(e);
    else groups.push({ key, label: dayLabel(d, now), items: [e] });
  }
  return groups;
}

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ZoneEventsFeed({ kids, zones }: Props): ReactElement {
  const [childIdRaw, setChildId] = useState('');
  const [zoneIdRaw, setZoneId] = useState('');
  const childSelectId = useId();
  const zoneSelectId = useId();
  // Выбранных в фильтре зону/ребёнка удалили — фильтр по ним больше не применяем.
  const childId = kids.some((k) => k.id === childIdRaw) ? childIdRaw : '';
  const zoneId = zones.some((z) => z.id === zoneIdRaw) ? zoneIdRaw : '';
  const { data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useZoneEvents({ childId, zoneId });

  const events = data?.pages.flatMap((p) => p.items) ?? [];
  const groups = groupByDay(events);
  const filtered = childId !== '' || zoneId !== '';
  // Срок «не пришёл» — из текущих настроек зоны (в событии его нет).
  const deadlines = useMemo(
    () => new Map(zones.map((z) => [z.id, z.arrival?.deadlineMin ?? null])),
    [zones],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={childSelectId} className="sr-only">
          Ребёнок
        </label>
        <select
          id={childSelectId}
          className={SELECT_CLASS}
          value={childId}
          onChange={(e) => setChildId(e.target.value)}
        >
          <option value="">Все дети</option>
          {kids.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
        <label htmlFor={zoneSelectId} className="sr-only">
          Зона
        </label>
        <select
          id={zoneSelectId}
          className={SELECT_CLASS}
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
        >
          <option value="">Все зоны</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={() => {
              setChildId('');
              setZoneId('');
            }}
          >
            Сбросить
          </Button>
        )}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      ) : isError && events.length === 0 ? (
        <div className="text-sm text-destructive">
          Не удалось загрузить события.{' '}
          <button type="button" className="underline" onClick={() => refetch()}>
            Повторить
          </button>
        </div>
      ) : events.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filtered
            ? 'По выбранным фильтрам событий нет.'
            : 'Событий пока нет — они появятся, когда ребёнок войдёт в зону или выйдет из неё.'}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </h3>
              <ul className="divide-y divide-border">
                {g.items.map((e) => (
                  <EventRow key={e.id} e={e} deadlineMin={deadlines.get(e.zoneId) ?? null} />
                ))}
              </ul>
            </section>
          ))}
          {hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ e, deadlineMin }: { e: ZoneEvent; deadlineMin: number | null }): ReactElement {
  const d = new Date(e.recordedAt);
  const zoneName = <span style={{ color: e.zoneColor }}>«{e.zoneName}»</span>;
  const child = <strong className="font-semibold">{e.childName}</strong>;

  let icon: ReactElement = (
    <span className="text-base leading-5" aria-hidden>
      {ZONE_ICON_EMOJI[e.zoneIcon] ?? '📍'}
    </span>
  );
  let body: ReactElement;
  switch (e.type) {
    case 'missed_arrival':
      icon = <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />;
      body = (
        <>
          {child} —{' '}
          <span className="text-destructive">
            не пришёл(а){deadlineMin !== null ? ` к ${minutesToHHMM(deadlineMin)}` : ''} в
          </span>{' '}
          {zoneName}
        </>
      );
      break;
    case 'no_data':
      icon = (
        <WifiOff
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden
        />
      );
      body = (
        <>
          {child} —{' '}
          <span className="text-amber-700 dark:text-amber-400">нет данных от телефона к сроку</span>{' '}
          {zoneName}
        </>
      );
      break;
    case 'entry':
      body = (
        <>
          {child} — вход в {zoneName}
        </>
      );
      break;
    case 'exit':
      body = (
        <>
          {child} — выход из {zoneName}
          {e.durationSec !== null && e.durationSec !== undefined && (
            <span className="text-muted-foreground">
              {' '}
              · пробыл(а) {formatDuration(e.durationSec)}
            </span>
          )}
        </>
      );
      break;
    default:
      // Тип из будущей версии backend'а — не падаем, показываем нейтрально.
      body = (
        <>
          {child} — событие в {zoneName}
        </>
      );
  }

  return (
    <li className="flex items-start gap-2 py-2 text-sm">
      <time
        dateTime={e.recordedAt}
        title={d.toLocaleString('ru-RU')}
        className="min-w-[44px] pt-px tabular-nums text-muted-foreground"
      >
        {formatClock(d)}
      </time>
      {icon}
      <span className="min-w-0 text-foreground">{body}</span>
    </li>
  );
}
