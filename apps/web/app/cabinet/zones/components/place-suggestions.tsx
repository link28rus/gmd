// apps/web/app/cabinet/zones/components/place-suggestions.tsx
// v0.67.0 (геозоны v2, этап 4): подсказки мест по частым стоянкам детей.
'use client';

import type { ReactElement } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { zoneErrorMessage, type PlaceSuggestion } from '@/lib/api/zones';
import { useDismissSuggestion, useZoneSuggestions } from '@/lib/hooks/use-zones';
import { ZONE_ICON_EMOJI, suggestionEvidence, suggestionTitle } from './zone-format';

interface Props {
  kidNames: Map<string, string>;
  /** «Сохранить» — редактор новой зоны с данными подсказки. */
  onSave: (s: PlaceSuggestion) => void;
  /** Показать место на карте. */
  onShow: (s: PlaceSuggestion) => void;
  /** Лимит зон исчерпан. */
  saveDisabled: boolean;
}

/** Блок «Подсказки»: пока пусто, грузится или ошибка — блока нет. */
export function PlaceSuggestions({
  kidNames,
  onSave,
  onShow,
  saveDisabled,
}: Props): ReactElement | null {
  const { data } = useZoneSuggestions();
  const dismiss = useDismissSuggestion();
  if (!data || data.length === 0) return null;
  const manyKids = kidNames.size > 1;

  return (
    <section aria-label="Подсказки мест" className="mb-4 rounded-md border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">Подсказки</h2>
        <p className="text-xs text-muted-foreground">
          Места, где дети часто бывали за последние 30 дней. Нужные сохраните как зоны.
        </p>
      </div>
      <ul className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
        {data.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 bg-card px-4 py-3">
            <button
              type="button"
              onClick={() => onShow(s)}
              title="Показать на карте"
              className="flex items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span aria-hidden className="text-base leading-none">
                {ZONE_ICON_EMOJI[s.icon] ?? '📍'}
              </span>
              <span className="text-sm font-medium text-foreground">{suggestionTitle(s.kind)}</span>
            </button>
            <ul className="space-y-0.5">
              {s.children
                .filter((c) => kidNames.has(c.childId))
                .map((c) => (
                  <li key={c.childId} className="text-xs text-muted-foreground">
                    {manyKids ? `${kidNames.get(c.childId)}: ` : ''}
                    {suggestionEvidence(s.kind, c)}
                  </li>
                ))}
            </ul>
            <div className="mt-auto flex flex-wrap gap-1">
              <Button
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={saveDisabled}
                title={saveDisabled ? 'Достигнут лимит зон' : undefined}
                onClick={() => onSave(s)}
              >
                Сохранить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={dismiss.isPending}
                onClick={() =>
                  dismiss.mutate(s, {
                    onError: (e) => toast.error(zoneErrorMessage(e, 'dismiss')),
                  })
                }
              >
                Больше не показывать
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
