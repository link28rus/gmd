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

// Чтобы не перегружать карту при больших треках (сотни точек), показываем
// кружочки каждую N-ю точку. Первая и последняя — всегда.
const MAX_DOTS = 120;

function sampleForDots(items: LocationDto[]): LocationDto[] {
  if (items.length <= MAX_DOTS) return items;
  const step = Math.ceil(items.length / MAX_DOTS);
  const out: LocationDto[] = [];
  for (let i = 0; i < items.length; i += step) out.push(items[i]);
  if (out[out.length - 1] !== items[items.length - 1]) {
    out.push(items[items.length - 1]);
  }
  return out;
}

export function TrackPolyline({ items }: Props): ReactElement | null {
  if (items.length < 2) return null;
  const coords = items.map((p) => [p.lon, p.lat] as [number, number]);
  const first = items[0];
  const last = items[items.length - 1];
  const dots = sampleForDots(items);
  return (
    <>
      <YMapFeature
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        geometry={{ type: 'LineString', coordinates: coords } as any}
        style={
          {
            stroke: [{ color: '#2563eb', width: 3, dash: [8, 6] }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any
        }
      />
      {dots.map((p, i) => {
        if (p === first || p === last) return null;
        return (
          <YMapMarker key={`${p.recordedAt}-${i}`} coordinates={[p.lon, p.lat]}>
            <div
              className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#2563eb] bg-white"
              title={hhmm(p.recordedAt)}
            />
          </YMapMarker>
        );
      })}
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
