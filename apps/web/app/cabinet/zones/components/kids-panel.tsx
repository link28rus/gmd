// apps/web/app/cabinet/zones/components/kids-panel.tsx
'use client';

import type { ReactElement } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Zone } from '@/lib/api/zones';
import type { FamilyLatestItem } from '@/lib/api/locations';
import { formatAgeShort } from '@/lib/date/age-format';

interface Props {
  kids: Array<{ id: string; name: string }>;
  zones: Zone[];
  latest: FamilyLatestItem[];
  latestLoading: boolean;
  latestError: boolean;
  /** Показать ребёнка на карте. */
  onFocus: (point: FamilyLatestItem) => void;
  /** «Зона здесь» — редактор с центром в точке ребёнка. */
  onCreateAt: (childId: string, lat: number, lon: number) => void;
  /** Лимит зон исчерпан — кнопка неактивна. */
  createDisabled: boolean;
}

/** Компактный блок «Дети»: где сейчас (по states зон), давность точки, «Зона здесь». */
export function KidsPanel({
  kids,
  zones,
  latest,
  latestLoading,
  latestError,
  onFocus,
  onCreateAt,
  createDisabled,
}: Props): ReactElement | null {
  if (kids.length === 0) return null;
  const pointByKid = new Map(latest.map((p) => [p.childId, p]));

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">Дети</h2>
      </div>
      <ul className="divide-y divide-border">
        {kids.map((kid) => {
          const point = pointByKid.get(kid.id);
          const insideZones = zones
            .filter((z) => (z.states ?? []).some((s) => s.childId === kid.id && s.isInside))
            .map((z) => z.name);
          let where: string;
          if (insideZones.length > 0) where = `в зоне «${insideZones.join('», «')}»`;
          else if (point) where = 'вне зон';
          else if (latestLoading) where = 'загружаем…';
          else if (latestError) where = 'точки не загрузились';
          else where = 'нет данных о местоположении';

          return (
            <li key={kid.id} className="flex items-center gap-2 px-4 py-2">
              <button
                type="button"
                disabled={!point}
                onClick={() => point && onFocus(point)}
                title={point ? 'Показать на карте' : undefined}
                className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              >
                <p className="truncate text-sm font-medium text-foreground">{kid.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {where}
                  {point ? ` · ${formatAgeShort(point.ageSec)}` : ''}
                </p>
              </button>
              {point && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-xs"
                  disabled={createDisabled}
                  title={createDisabled ? 'Достигнут лимит зон' : 'Создать зону в точке ребёнка'}
                  onClick={() => onCreateAt(kid.id, point.lat, point.lon)}
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  Зона здесь
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
