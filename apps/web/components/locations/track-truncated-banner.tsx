'use client';
import type { ReactElement } from 'react';

export function TrackTruncatedBanner(): ReactElement {
  return (
    <div
      role="status"
      className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
    >
      Трек обрезан до 2000 точек. Уточните диапазон, выбрав более короткий период.
    </div>
  );
}
