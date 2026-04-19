'use client';
import { useEffect, useMemo, type ReactElement } from 'react';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  YMap,
  YMapComponentsProvider,
  YMapDefaultSchemeLayer,
  YMapDefaultFeaturesLayer,
  YMapControls,
  YMapZoomControl,
} from 'ymap3-components';
import type { LatestLocationDto, LocationDto } from '@/lib/api/locations';
import { LatestMarker } from './latest-marker';
import { TrackPolyline } from './track-polyline';

export interface ChildMapInnerProps {
  childName: string;
  latest: LatestLocationDto | null;
  track: LocationDto[];
  onMapError: () => void;
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;

export function ChildMapInner({
  childName,
  latest,
  track,
  onMapError,
}: ChildMapInnerProps): ReactElement {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? '';

  const initialLocation = useMemo(() => {
    if (track.length >= 2) {
      const lons = track.map((p) => p.lon);
      const lats = track.map((p) => p.lat);
      return {
        bounds: [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ] as [[number, number], [number, number]],
      };
    }
    if (latest) return { center: [latest.lon, latest.lat] as [number, number], zoom: 15 };
    return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  }, [latest, track]);

  useEffect(() => {
    if (!apiKey) onMapError();
  }, [apiKey, onMapError]);

  if (!apiKey) return <></>;

  return (
    <YMapComponentsProvider apiKey={apiKey} lang="ru_RU" onError={() => onMapError()}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <YMap location={initialLocation as any} className="h-full w-full">
        <YMapDefaultSchemeLayer />
        <YMapDefaultFeaturesLayer />
        <YMapControls position="right">
          <YMapZoomControl />
        </YMapControls>
        {latest && (
          <LatestMarker
            lat={latest.lat}
            lon={latest.lon}
            accuracy={latest.accuracy}
            childName={childName}
          />
        )}
        <TrackPolyline items={track} />
      </YMap>
    </YMapComponentsProvider>
  );
}
