// apps/web/app/cabinet/zones/components/zone-stats.tsx
'use client';

import { useState, type ReactElement } from 'react';
import type { ZoneChildUsage, ZoneStatsPeriod } from '@/lib/api/zones';
import { useZoneStats } from '@/lib/hooks/use-zones';
import { formatDuration, plural, zoneStatsLines } from './zone-format';

const PERIODS: ReadonlyArray<{ value: ZoneStatsPeriod; label: string }> = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: '7 дней' },
  { value: 'month', label: '30 дней' },
];

interface Props {
  zoneId: string;
  kidNames: Map<string, string>;
}

/** Монтируется только у раскрытой зоны. */
export function ZoneStats({ zoneId, kidNames }: Props): ReactElement {
  const [period, setPeriod] = useState<ZoneStatsPeriod>('week');
  const { data, isPending, isError } = useZoneStats(zoneId, period);
  const children = (data?.children ?? []).filter((c) => kidNames.has(c.childId));

  return (
    <section aria-label="Статистика зоны" className="space-y-3">
      <h3 className="text-xs font-semibold text-foreground">Статистика зоны</h3>
      <div role="group" aria-label="Период статистики" className="flex flex-wrap gap-1.5">
        {PERIODS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            className="min-h-9 rounded-full border border-border px-3 text-xs font-medium hover:bg-accent aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            onClick={() => setPeriod(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {isPending ? (
        <p className="text-xs text-muted-foreground">Загрузка…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">Не удалось загрузить статистику.</p>
      ) : children.length === 0 ? (
        <p className="text-xs text-muted-foreground">К зоне пока не привязаны дети.</p>
      ) : (
        <ul className="space-y-2">
          {children.map((c) => (
            <li key={c.childId} className="space-y-1 border-t border-border pt-2">
              <p className="text-xs font-medium">{kidNames.get(c.childId)}</p>
              {c.visits > 0 ? (
                <>
                  <p className="text-sm font-semibold">В зоне · {formatDuration(c.totalSec)}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.visits} {plural(c.visits, 'визит', 'визита', 'визитов')} · в среднем{' '}
                    {formatDuration(c.avgSec)}
                  </p>
                  {zoneStatsLines(c)
                    .slice(1)
                    .map((line) => (
                      <p key={line} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  <AppUsage usage={c.usage} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Нет подтверждённых визитов за этот период.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AppUsage({ usage }: { usage?: ZoneChildUsage }): ReactElement {
  if (!usage || usage.coverage === 'none') {
    return (
      <p className="pt-1 text-xs text-muted-foreground">
        Нет данных об использовании приложений в зоне.
      </p>
    );
  }
  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs font-medium">
        Экранное время · {usage.totalSec > 0 ? formatDuration(usage.totalSec) : '0 мин'}
      </p>
      {usage.apps.length > 0 && (
        <ul className="space-y-1 text-xs">
          {usage.apps.map((app) => (
            <li key={app.packageName} className="flex justify-between gap-2">
              <span className="min-w-0 break-words">{app.appLabel || app.packageName}</span>
              <span className="shrink-0 tabular-nums">{formatDuration(app.seconds)}</span>
            </li>
          ))}
        </ul>
      )}
      {usage.coverage === 'partial' && (
        <p className="text-xs text-muted-foreground">
          Данные об активности есть за часть времени в зоне.
        </p>
      )}
    </div>
  );
}
