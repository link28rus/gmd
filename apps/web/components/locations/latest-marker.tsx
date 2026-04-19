'use client';
import type { ReactElement } from 'react';
import { YMapMarker, YMapFeature } from 'ymap3-components';
import { circlePolygon } from '@/lib/geo/circle-polygon';

interface Props {
  lat: number;
  lon: number;
  accuracy: number | null;
  childName: string;
}

export function LatestMarker({ lat, lon, accuracy, childName }: Props): ReactElement {
  const initial = childName.trim().charAt(0).toUpperCase() || '?';
  return (
    <>
      {accuracy !== null && (
        <YMapFeature
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          geometry={
            {
              type: 'Polygon',
              coordinates: [circlePolygon(lat, lon, accuracy)],
            } as any
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          style={
            {
              stroke: [{ color: 'rgba(59,130,246,0.5)', width: 1 }],
              fill: 'rgba(59,130,246,0.15)',
            } as any
          }
        />
      )}
      <YMapMarker coordinates={[lon, lat]}>
        <div
          className="flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow-md"
          title={childName}
        >
          <span className="text-sm font-semibold">{initial}</span>
        </div>
      </YMapMarker>
    </>
  );
}
