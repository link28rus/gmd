// apps/web/app/cabinet/zones/components/zones-list.tsx
'use client';

import type { ReactElement } from 'react';
import { AlarmClock, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_ZONES, type Zone } from '@/lib/api/zones';
import { ZONE_ICON_EMOJI, formatDaysMask, formatScheduleShort, minutesToHHMM } from './zone-format';
import { MyNotifications } from './my-notifications';
import { ZoneStats } from './zone-stats';

const RULE_BADGE_CLASS =
  'inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground';

function RuleBadges({ zone }: { zone: Zone }): ReactElement | null {
  const { schedule, arrival } = zone;
  if (!schedule && !arrival) return null;
  const tz = zone.timezone ? ` (${zone.timezone})` : '';
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {schedule && (
        <span
          className={RULE_BADGE_CLASS}
          title={`Уведомления о приходе и уходе только в это время${tz}`}
        >
          <CalendarClock className="h-3 w-3" aria-hidden />
          по расписанию {formatScheduleShort(schedule)}
        </span>
      )}
      {arrival && (
        <span
          className={RULE_BADGE_CLASS}
          title={`Не пришёл к сроку: ${formatDaysMask(arrival.daysMask)}, запас ${arrival.graceMin} мин${tz}`}
        >
          <AlarmClock className="h-3 w-3" aria-hidden />
          срок {minutesToHHMM(arrival.deadlineMin)}
        </span>
      )}
    </div>
  );
}

interface Props {
  zones: Zone[];
  /** id → имя ребёнка (для чипов «сейчас в зоне» и назначений). */
  kidNames: Map<string, string>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onCreate?: () => void;
  onEdit?: (zone: Zone) => void;
  onDelete?: (zone: Zone) => void;
}

function assignedText(zone: Zone, kidNames: Map<string, string>): string {
  if (zone.allChildren) return 'Все дети';
  const names = (zone.childIds ?? []).map((id) => kidNames.get(id)).filter((n): n is string => !!n);
  return names.length > 0 ? names.join(', ') : 'Никто не назначен';
}

export function ZonesList({
  zones,
  kidNames,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
}: Props): ReactElement {
  const canCreate = zones.length < MAX_ZONES;

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          Зоны ({zones.length}/{MAX_ZONES})
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          disabled={!canCreate || !onCreate}
          title={canCreate ? undefined : `Не больше ${MAX_ZONES} зон на семью`}
          onClick={onCreate}
        >
          + Новая
        </Button>
      </div>

      {zones.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">У вас нет геозон.</p>
          <p className="text-xs text-muted-foreground">
            Создайте геозону, чтобы получать уведомления, когда ребёнок входит в неё или выходит.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 text-xs"
            disabled={!onCreate}
            onClick={onCreate}
          >
            + Новая зона
          </Button>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {zones.map((zone) => {
            const isSelected = zone.id === selectedId;
            const inside = (zone.states ?? [])
              .filter((s) => s.isInside)
              .map((s) => ({ id: s.childId, name: kidNames.get(s.childId) }))
              .filter((k): k is { id: string; name: string } => !!k.name);
            return (
              <li key={zone.id} className={isSelected ? 'bg-muted' : 'bg-card'}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect?.(zone.id)}
                  className="block w-full px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: zone.color }}
                    />
                    <span aria-hidden className="text-base leading-none">
                      {ZONE_ICON_EMOJI[zone.icon] ?? '📍'}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">
                      {zone.name}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Радиус {zone.radius} м · {assignedText(zone, kidNames)}
                  </p>
                  <RuleBadges zone={zone} />
                  {inside.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-xs text-muted-foreground">Сейчас в зоне:</span>
                      {inside.map((k) => (
                        <span
                          key={k.id}
                          className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground"
                        >
                          {k.name}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                {isSelected && (
                  <div className="space-y-4 px-4 pb-3">
                    <MyNotifications zone={zone} kidNames={kidNames} />
                    <ZoneStats zoneId={zone.id} kidNames={kidNames} />
                  </div>
                )}
                {isSelected && (onEdit || onDelete) && (
                  <div className="flex justify-end gap-1 px-4 pb-3">
                    {onEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs"
                        onClick={() => onEdit(zone)}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Изменить
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onDelete(zone)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Удалить
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
