'use client';
import type { ReactElement } from 'react';

interface Props {
  ageSec: number;
  accuracy: number | null;
  batteryLevel: number | null;
}

function formatAge(ageSec: number): { text: string; variant: 'green' | 'gray' | 'yellow' | 'red' } {
  if (ageSec < 60)
    return { text: `Обновлено ${Math.max(0, Math.round(ageSec))} сек назад`, variant: 'green' };
  if (ageSec < 300)
    return { text: `Обновлено ${Math.round(ageSec / 60)} мин назад`, variant: 'gray' };
  if (ageSec < 1800)
    return { text: `Давно не обновлялось: ${Math.round(ageSec / 60)} мин`, variant: 'yellow' };
  return {
    text: `Устройство не выходило на связь: ${Math.round(ageSec / 60)} мин`,
    variant: 'red',
  };
}

const VARIANTS = {
  green: 'bg-green-50 border-green-200 text-green-900',
  gray: 'bg-zinc-50 border-zinc-200 text-zinc-700',
  yellow: 'bg-yellow-50 border-yellow-200 text-yellow-900',
  red: 'bg-red-50 border-red-200 text-red-900',
} as const;

export function StaleIndicator({ ageSec, accuracy, batteryLevel }: Props): ReactElement {
  const { text, variant } = formatAge(ageSec);
  const extras: string[] = [];
  if (accuracy !== null) extras.push(`±${Math.round(accuracy)} м`);
  if (batteryLevel !== null) extras.push(`🔋 ${batteryLevel}%`);
  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm shadow-sm ${VARIANTS[variant]}`}
    >
      <span>📍 {text}</span>
      {extras.length > 0 && <span className="text-xs opacity-80">· {extras.join(' · ')}</span>}
    </div>
  );
}
