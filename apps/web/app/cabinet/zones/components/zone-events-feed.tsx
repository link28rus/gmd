// apps/web/app/cabinet/zones/components/zone-events-feed.tsx
'use client';

import { useZoneEvents } from '@/lib/hooks/use-zone-events';

const ICON_EMOJI: Record<string, string> = {
  home: '🏠',
  school: '🏫',
  sport: '⚽',
  art: '🎨',
  hospital: '🏥',
  shop: '🏪',
  music: '🎵',
  other: '📍',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

export function ZoneEventsFeed() {
  const { data, isLoading, isError, error } = useZoneEvents({ limit: 50 });

  if (isLoading) return <div className="text-sm text-muted-foreground">Загружаем…</div>;
  if (isError)
    return (
      <div className="text-sm text-red-600">
        {error instanceof Error ? error.message : 'Ошибка'}
      </div>
    );

  const events = data?.items ?? [];
  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        Событий пока нет — зоны активируются при следующей точке от устройства ребёнка.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-200">
      {events.map((e) => (
        <li key={e.id} className="py-2 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums min-w-[44px]">
            {formatTime(e.createdAt)}
          </span>
          <span className="text-lg" aria-hidden>
            {ICON_EMOJI[e.zoneIcon] ?? '📍'}
          </span>
          <span>
            <strong>{e.childName}</strong> {e.type === 'entry' ? 'вошла в' : 'вышла из'}{' '}
            <span style={{ color: e.zoneColor }}>«{e.zoneName}»</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
