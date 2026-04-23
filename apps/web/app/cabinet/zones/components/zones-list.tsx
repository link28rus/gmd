// apps/web/app/cabinet/zones/components/zones-list.tsx
'use client';

import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import type { Zone } from '@/lib/api/zones';

interface Props {
  zones: Zone[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onCreate?: () => void;
  onEdit?: (zone: Zone) => void;
}

const MAX_ZONES = 20;

export function ZonesList({ zones, selectedId, onSelect, onCreate, onEdit }: Props): ReactElement {
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
          onClick={onCreate}
        >
          + Новая
        </Button>
      </div>

      {zones.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">У вас нет геозон.</p>
          <p className="text-xs text-muted-foreground">
            Создайте геозону, чтобы получать уведомления когда ребёнок входит или покидает её.
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
        <ul className="flex-1 overflow-y-auto divide-y divide-zinc-100">
          {zones.map((zone) => {
            const isSelected = zone.id === selectedId;
            return (
              <li
                key={zone.id}
                onClick={() => onSelect?.(zone.id)}
                className={[
                  'cursor-pointer px-4 py-3 transition-colors',
                  isSelected ? 'bg-muted' : 'bg-card hover:bg-muted',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{zone.name}</p>
                    {zone.address && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {zone.address}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Радиус: {zone.radiusMeters ?? zone.radius} м
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {zone.active !== undefined && (
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          zone.active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-muted text-muted-foreground',
                        ].join(' ')}
                      >
                        {zone.active ? 'Активна' : 'Отключена'}
                      </span>
                    )}
                    {isSelected && onEdit && (
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-zinc-200 hover:text-foreground transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(zone);
                        }}
                      >
                        Изменить
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
