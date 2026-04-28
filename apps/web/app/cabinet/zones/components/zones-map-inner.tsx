// apps/web/app/cabinet/zones/components/zones-map-inner.tsx
'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import {
  YMap,
  YMapComponentsProvider,
  YMapDefaultSchemeLayer,
  YMapDefaultFeaturesLayer,
  YMapControls,
  YMapZoomControl,
  YMapFeature,
  YMapListener,
} from 'ymap3-components';
import type { Zone } from '@/lib/api/zones';
import { circlePolygon } from '@/lib/geo/circle-polygon';
import { useTheme } from '@/components/theme/theme-provider';

export interface ZonesMapInnerProps {
  zones: Zone[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMapError?: () => void;
  /** Whether to render zone polygons. Default: true. */
  showZones?: boolean;
  /** Fired on double-click on the map (lat, lon). */
  onMapDblClick?: (lat: number, lon: number) => void;
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;
const DBLCLICK_MS = 400;

export function ZonesMapInner({
  zones,
  selectedId,
  onSelect,
  onMapError,
  showZones = true,
  onMapDblClick,
}: ZonesMapInnerProps): ReactElement {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? '';
  const { theme } = useTheme();
  const mapTheme: 'light' | 'dark' = theme === 'light' ? 'light' : 'dark';
  const lastClickRef = useRef<{ t: number; lat: number; lon: number } | null>(null);

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

  const handleMapClick = (_obj: unknown, ev: { coordinates?: [number, number] }) => {
    if (!onMapDblClick) return;
    const c = ev?.coordinates;
    if (!c) return;
    const lat = c[1];
    const lon = c[0];
    const now = Date.now();
    const last = lastClickRef.current;
    if (last && now - last.t < DBLCLICK_MS) {
      lastClickRef.current = null;
      onMapDblClick(lat, lon);
      return;
    }
    lastClickRef.current = { t: now, lat, lon };
  };

  return (
    <YMapComponentsProvider apiKey={apiKey} lang="ru_RU" onError={() => onMapError?.()}>
      <YMap location={initialLocation as any} className="h-full w-full">
        <YMapDefaultSchemeLayer theme={mapTheme} />
        <YMapDefaultFeaturesLayer />
        <YMapControls position="right">
          <YMapZoomControl />
        </YMapControls>

        {onMapDblClick && <YMapListener {...({ onClick: handleMapClick } as any)} />}

        {showZones &&
          zones.map((zone) => {
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
