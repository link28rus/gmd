'use client';
import type { ReactElement } from 'react';
import { YMapFeature, YMapMarker } from 'ymap3-components';
import type { LocationDto } from '@/lib/api/locations';

interface Props {
  items: LocationDto[];
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TrackPolyline({ items }: Props): ReactElement | null {
  if (items.length < 2) return null;
  const coords = items.map((p) => [p.lon, p.lat] as [number, number]);
  const first = items[0];
  const last = items[items.length - 1];
  return (
    <>
      <YMapFeature
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geometry={{ type: 'LineString', coordinates: coords } as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style={
          {
            stroke: [
              { color: 'rgba(255,255,255,0.7)', width: 6 },
              { color: 'rgba(37,99,235,0.9)', width: 4 },
            ],
          } as any
        }
      />
      <YMapMarker coordinates={[first.lon, first.lat]}>
        <div
          className="h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-green-600 shadow"
          title={`Начало: ${hhmm(first.recordedAt)}`}
        />
      </YMapMarker>
      <YMapMarker coordinates={[last.lon, last.lat]}>
        <div
          className="h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-red-600 shadow"
          title={`Конец: ${hhmm(last.recordedAt)}`}
        />
      </YMapMarker>
    </>
  );
}
