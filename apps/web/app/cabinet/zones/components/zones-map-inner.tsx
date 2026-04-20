// apps/web/app/cabinet/zones/components/zones-map-inner.tsx
'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, type ReactElement } from 'react';
import {
  YMap,
  YMapComponentsProvider,
  YMapDefaultSchemeLayer,
  YMapDefaultFeaturesLayer,
  YMapControls,
  YMapZoomControl,
  YMapFeature,
} from 'ymap3-components';
import type { Zone } from '@/lib/api/zones';
import { circlePolygon } from '@/lib/geo/circle-polygon';

export interface ZonesMapInnerProps {
  zones: Zone[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMapError?: () => void;
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;

export function ZonesMapInner({
  zones,
  selectedId,
  onSelect,
  onMapError,
}: ZonesMapInnerProps): ReactElement {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? '';

  const initialLocation = useMemo(() => {
    if (zones.length >= 2) {
      const lons = zones.map((z) => z.centerLon);
      const lats = zones.map((z) => z.centerLat);
      return {
        bounds: [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ] as [[number, number], [number, number]],
      };
    }
    if (zones.length === 1) {
      return { center: [zones[0].centerLon, zones[0].centerLat] as [number, number], zoom: 13 };
    }
    return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
  }, [zones]);

  useEffect(() => {
    if (!apiKey) onMapError?.();
  }, [apiKey, onMapError]);

  if (!apiKey) return <></>;

  return (
    <YMapComponentsProvider apiKey={apiKey} lang="ru_RU" onError={() => onMapError?.()}>
      <YMap location={initialLocation as any} className="h-full w-full">
        <YMapDefaultSchemeLayer />
        <YMapDefaultFeaturesLayer />
        <YMapControls position="right">
          <YMapZoomControl />
        </YMapControls>

        {zones.map((zone) => {
          const isSelected = zone.id === selectedId;
          const baseColor = zone.color ?? '#3b82f6';
          const fillOpacity = isSelected ? 0.35 : 0.2;
          const strokeWidth = isSelected ? 3 : 2;

          return (
            <YMapFeature
              key={zone.id}
              geometry={
                {
                  type: 'Polygon',
                  coordinates: [circlePolygon(zone.centerLat, zone.centerLon, zone.radius)],
                } as any
              }
              style={
                {
                  stroke: [{ color: baseColor, width: strokeWidth }],
                  fill: baseColor,
                  fillOpacity,
                  cursor: 'pointer',
                } as any
              }
              onClick={() => onSelect?.(zone.id)}
            />
          );
        })}
      </YMap>
    </YMapComponentsProvider>
  );
}
