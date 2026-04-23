'use client';
import type { ReactElement } from 'react';
import { todayIso, daysAgoIso } from '@/lib/date/day-bounds';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const CHIPS: Array<{ label: string; get: () => string }> = [
  { label: 'Сегодня', get: todayIso },
  { label: 'Вчера', get: () => daysAgoIso(1) },
  { label: 'Позавчера', get: () => daysAgoIso(2) },
];

export function DateSelector({ value, onChange }: Props): ReactElement {
  const today = todayIso();
  const thirtyAgo = daysAgoIso(30);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
      {CHIPS.map((c) => {
        const v = c.get();
        const active = v === value;
        return (
          <button
            key={c.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={`rounded-full border px-3 py-1 text-sm transition ${
              active
                ? 'border-blue-600 bg-accent/30 text-blue-900'
                : 'border-border bg-card text-foreground hover:bg-muted'
            }`}
          >
            {c.label}
          </button>
        );
      })}
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="sr-only">Дата трека</span>
        <input
          type="date"
          aria-label="Дата трека"
          value={value}
          min={thirtyAgo}
          max={today}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-border px-2 py-1 text-sm"
        />
      </label>
    </div>
  );
}
