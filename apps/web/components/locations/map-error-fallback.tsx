'use client';
import type { ReactElement, ReactNode } from 'react';

interface LatestLite {
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
}

interface Props {
  latest: LatestLite | null;
  /** Блок действий (toggle защиты, отвязать устройство, удалить ребёнка). */
  actions?: ReactNode;
}

export function MapErrorFallback({ latest, actions }: Props): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center">
      <p className="text-foreground">
        Не удалось загрузить карту Яндекса. Попробуйте обновить страницу.
      </p>
      {latest && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Последние координаты: {latest.lat.toFixed(5)}, {latest.lon.toFixed(5)}
            {latest.accuracy !== null && ` (±${Math.round(latest.accuracy)} м)`}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(latest.recordedAt).toLocaleString('ru-RU')}
          </p>
          <a
            href={`https://yandex.ru/maps/?pt=${encodeURIComponent(`${latest.lon},${latest.lat}`)}&z=15`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted"
          >
            Открыть в Яндекс.Картах
          </a>
        </div>
      )}
      {actions && (
        <div className="mt-4 w-full max-w-[320px] overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm">
          {actions}
        </div>
      )}
    </div>
  );
}
