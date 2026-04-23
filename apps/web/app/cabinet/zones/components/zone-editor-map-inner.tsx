// apps/web/app/cabinet/zones/components/zone-editor-map-inner.tsx
'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ReactElement } from 'react';
import {
  YMap,
  YMapComponentsProvider,
  YMapDefaultSchemeLayer,
  YMapDefaultFeaturesLayer,
  YMapControls,
  YMapZoomControl,
  YMapFeature,
  YMapMarker,
} from 'ymap3-components';
import { circlePolygon } from '@/lib/geo/circle-polygon';

export interface ZoneEditorMapInnerProps {
  centerLat: number;
  centerLon: number;
  radius: number;
  color: string;
  onCenterChange: (lat: number, lon: number) => void;
  onRadiusChange: (m: number) => void;
}

export function ZoneEditorMapInner({
  centerLat,
  centerLon,
  radius,
  color,
  onCenterChange,
  onRadiusChange,
}: ZoneEditorMapInnerProps): ReactElement {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? '';

  if (!apiKey) {
    return (
      <div className="h-[400px] rounded-md flex items-center justify-center bg-muted text-muted-foreground text-sm">
        Карта недоступна (нет API-ключа)
      </div>
    );
  }

  const center: [number, number] = [centerLon, centerLat];
  const handleLon = centerLon + radiusToLonDelta(radius, centerLat);
  const handleLat = centerLat;

  return (
    <YMapComponentsProvider apiKey={apiKey} lang="ru_RU">
      <div className="h-[400px] rounded-md overflow-hidden">
        <YMap location={{ center, zoom: 15 }} className="h-full w-full">
          <YMapDefaultSchemeLayer />
          <YMapDefaultFeaturesLayer />
          <YMapControls position="right">
            <YMapZoomControl />
          </YMapControls>

          <YMapFeature
            geometry={
              {
                type: 'Polygon',
                coordinates: [circlePolygon(centerLat, centerLon, radius)],
              } as any
            }
            style={
              {
                fill: color,
                fillOpacity: 0.2,
                stroke: [{ color, width: 2 }],
              } as any
            }
          />

          {/* Маркер центра зоны */}
          <YMapMarker
            coordinates={center}
            {...({ draggable: true } as any)}
            {...({
              onDragEnd: (coords: [number, number]) => {
                onCenterChange(coords[1], coords[0]);
              },
            } as any)}
          >
            <div
              className="w-4 h-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-card border-2"
              style={{ borderColor: color, cursor: 'move' }}
            />
          </YMapMarker>

          {/* Handle для изменения радиуса — на восточной границе */}
          <YMapMarker
            coordinates={[handleLon, handleLat]}
            {...({ draggable: true } as any)}
            {...({
              onDragEnd: (coords: [number, number]) => {
                const newRadius = Math.round(
                  haversineM(centerLat, centerLon, coords[1], coords[0]),
                );
                onRadiusChange(Math.max(50, Math.min(5000, newRadius)));
              },
            } as any)}
          >
            <div
              className="w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-card border-2"
              style={{ borderColor: color, cursor: 'ew-resize' }}
            />
          </YMapMarker>
        </YMap>
      </div>
    </YMapComponentsProvider>
  );
}

/**
 * Смещение долготы для расстояния r (метров) на широте lat.
 * 1° долготы ≈ 111320 * cos(lat) метров.
 */
function radiusToLonDelta(m: number, lat: number): number {
  return m / (111320 * Math.cos((lat * Math.PI) / 180));
}

/**
 * Расстояние по формуле гаверсинуса (метры).
 */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
