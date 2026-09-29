// apps/web/app/cabinet/zones/components/zone-stats.tsx
// v0.67.0 (геозоны v2, этап 4): статистика визитов в зону за 30 дней.
'use client';

import type { ReactElement } from 'react';
import { useZoneStats } from '@/lib/hooks/use-zones';
import { zoneStatsLines } from './zone-format';

interface Props {
  zoneId: string;
  kidNames: Map<string, string>;
}

/** Монтируется только у раскрытой зоны — запрос уходит по клику. */
export function ZoneStats({ zoneId, kidNames }: Props): ReactElement {
  const { data, isPending, isError } = useZoneStats(zoneId);
  const children = (data?.children ?? []).filter((c) => kidNames.has(c.childId));

  return (
    <section aria-label="Статистика места" className="space-y-2">
      <h3 className="text-xs font-semibold text-foreground">
        Статистика за {data?.periodDays ?? 30} дней
      </h3>
      {isPending ? (
        <p className="text-xs text-muted-foreground">Загрузка…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">Не удалось загрузить статистику.</p>
      ) : children.length === 0 ? (
        <p className="text-xs text-muted-foreground">В зоне пока нет детей.</p>
      ) : (
        <ul className="space-y-2">
          {children.map((c) => (
            <li key={c.childId}>
              <p className="text-xs font-medium text-foreground">{kidNames.get(c.childId)}</p>
              {zoneStatsLines(c).map((line) => (
                <p key={line} className="text-xs text-muted-foreground">
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
