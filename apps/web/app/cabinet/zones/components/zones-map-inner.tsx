// apps/web/app/cabinet/zones/components/zones-map-inner.tsx
'use client';

import { useEffect, useMemo, type ReactElement } from 'react';
import { Circle, MapContainer, TileLayer, useMapEvents, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import type { Zone } from '@/lib/api/zones';
import { useTheme } from '@/components/theme/theme-provider';
import { tileConfigFor } from '@/lib/maps/tile-config';

export interface ZonesMapInnerProps {
  zones: Zone[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Сохранён в API ради обратной совместимости с обёрткой ZonesMap. */
  onMapError?: () => void;
  /** Whether to render zone polygons. Default: true. */
  showZones?: boolean;
  /** Fired on double-click on the map (lat, lon). */
  onMapDblClick?: (lat: number, lon: number) => void;
}

const DEFAULT_CENTER: [number, number] = [55.7558, 37.6173]; // Москва
const DEFAULT_ZOOM = 10;

function initialView(zones: Zone[]): {
  center: [number, number];
  zoom: number;
  bounds?: L.LatLngBoundsExpression;
} {
  if (zones.length >= 2) {
    const lats = zones.map((z) => z.centerLat);
    const lons = zones.map((z) => z.centerLon);
    const south = Math.min(...lats);
    const north = Math.max(...lats);
    const west = Math.min(...lons);
    const east = Math.max(...lons);
    return {
      center: [(south + north) / 2, (west + east) / 2],
      zoom: 11,
      bounds: [
        [south, west],
        [north, east],
      ],
    };
  }
  if (zones.length === 1) {
    return { center: [zones[0].centerLat, zones[0].centerLon], zoom: 13 };
  }
  return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

/** Слушает dblclick на карте и зовёт колбэк с lat/lon. */
function MapDblClickListener({
  onDblClick,
}: {
  onDblClick?: (lat: number, lon: number) => void;
}): null {
  useMapEvents({
    dblclick(e) {
      if (!onDblClick) return;
      onDblClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function ZonesMapInner({
  zones,
  selectedId,
  onSelect,
  showZones = true,
  onMapDblClick,
}: ZonesMapInnerProps): ReactElement {
  const { theme } = useTheme();
  const tile = tileConfigFor(theme);
  // Стартовая позиция считается ОДИН раз — карта дальше управляется
  // пользователем, мы её не «дёргаем» при каждом обновлении zones.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => initialView(zones), []);

  // Фикс default leaflet-иконок (нужен только если где-то покажется default
  // marker — нам тут не нужны, но safety на будущее).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
  }, []);

  return (
    <MapContainer
      center={view.center}
      zoom={view.zoom}
      bounds={view.bounds}
      className="h-full w-full"
      zoomControl={false}
      doubleClickZoom={onMapDblClick ? false : true}
    >
      <TileLayer
        key={tile.url}
        url={tile.url}
        attribution={tile.attribution}
        maxZoom={tile.maxZoom}
      />
      <ZoomControl position="topright" />
      <MapDblClickListener onDblClick={onMapDblClick} />

      {showZones &&
        zones.map((zone) => {
          const isSelected = zone.id === selectedId;
          const baseColor = zone.color ?? '#3b82f6';
          return (
            <Circle
              key={zone.id}
              center={[zone.centerLat, zone.centerLon]}
              radius={zone.radius}
              pathOptions={{
                color: baseColor,
                weight: isSelected ? 3 : 2,
                fillColor: baseColor,
                fillOpacity: isSelected ? 0.35 : 0.2,
              }}
              eventHandlers={{
                click: () => onSelect?.(zone.id),
              }}
            />
          );
        })}
    </MapContainer>
  );
}
