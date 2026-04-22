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
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-50 p-6 text-center">
      <p className="text-zinc-700">
        Не удалось загрузить карту Яндекса. Попробуйте обновить страницу.
      </p>
      {latest && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-600">
            Последние координаты: {latest.lat.toFixed(5)}, {latest.lon.toFixed(5)}
            {latest.accuracy !== null && ` (±${Math.round(latest.accuracy)} м)`}
          </p>
          <p className="text-xs text-zinc-500">
            {new Date(latest.recordedAt).toLocaleString('ru-RU')}
          </p>
          <a
            href={`https://yandex.ru/maps/?pt=${encodeURIComponent(`${latest.lon},${latest.lat}`)}&z=15`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
          >
            Открыть в Яндекс.Картах
          </a>
        </div>
      )}
      {actions && (
        <div className="mt-4 w-full max-w-[320px] overflow-hidden rounded-lg border border-zinc-200 bg-white text-left shadow-sm">
          {actions}
        </div>
      )}
    </div>
  );
}
