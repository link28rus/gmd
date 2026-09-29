// apps/web/app/cabinet/zones/components/toggle-switch.tsx
'use client';

import type { ReactElement } from 'react';

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Доступное имя, если рядом нет <label htmlFor>. */
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
  title?: string;
}

/** Переключатель в стиле тумблера «Показывать геозоны» (токены темы). */
export function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  id,
  disabled,
  title,
}: Props): ReactElement {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted-foreground/30',
      ].join(' ')}
    >
      <span
        className={[
          'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-card shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        ].join(' ')}
      />
    </button>
  );
}
