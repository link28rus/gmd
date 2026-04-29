// apps/web/app/cabinet/zones/components/zone-editor-map-inner.tsx
'use client';

import { useEffect, useMemo, type ReactElement } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMapEvents, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { useTheme } from '@/components/theme/theme-provider';
import { tileConfigFor } from '@/lib/maps/tile-config';

export interface ZoneEditorMapInnerProps {
  centerLat: number;
  centerLon: number;
  radius: number;
  color: string;
  onCenterChange: (lat: number, lon: number) => void;
  onRadiusChange: (m: number) => void;
}

/**
 * Смещение долготы для расстояния r (метров) на широте lat.
 * 1° долготы ≈ 111320 * cos(lat) метров.
 */
function radiusToLonDelta(m: number, lat: number): number {
  return m / (111320 * Math.cos((lat * Math.PI) / 180));
}

/** Расстояние по формуле гаверсинуса (метры). */
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

/** DivIcon — маленький кружок цвета зоны для draggable-маркеров. */
function dotIcon(color: string, size: number, cursor: string): L.DivIcon {
  return L.divIcon({
    html:
      `<div style="width:${size}px;height:${size}px;border-radius:50%;` +
      `background:var(--card,#ffffff);border:2px solid ${color};cursor:${cursor};` +
      `transform:translate(-50%,-50%);position:absolute;left:0;top:0;"></div>`,
    className: 'gmd-zone-handle',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function MapClickListener({ onClick }: { onClick: (lat: number, lon: number) => void }): null {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export function ZoneEditorMapInner({
  centerLat,
  centerLon,
  radius,
  color,
  onCenterChange,
  onRadiusChange,
}: ZoneEditorMapInnerProps): ReactElement {
  const { theme } = useTheme();
  const tile = tileConfigFor(theme);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
  }, []);

  // Hardcoded init view — карта дальше управляется свободно пользователем.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(
    () => ({ center: [centerLat, centerLon] as [number, number], zoom: 15 }),
    [],
  );

  // Координаты ручки радиуса — на восточной границе круга.
  const handleLat = centerLat;
  const handleLon = centerLon + radiusToLonDelta(radius, centerLat);

  const centerIcon = useMemo(() => dotIcon(color, 16, 'move'), [color]);
  const handleIcon = useMemo(() => dotIcon(color, 12, 'ew-resize'), [color]);

  return (
    <div className="h-[400px] rounded-md overflow-hidden">
      <MapContainer
        center={initial.center}
        zoom={initial.zoom}
        className="h-full w-full"
        zoomControl={false}
        doubleClickZoom={false}
      >
        <TileLayer
          key={tile.url}
          url={tile.url}
          attribution={tile.attribution}
          maxZoom={tile.maxZoom}
        />
        <ZoomControl position="topright" />

        <MapClickListener onClick={(lat, lon) => onCenterChange(lat, lon)} />

        <Circle
          center={[centerLat, centerLon]}
          radius={radius}
          pathOptions={{
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.2,
          }}
        />

        {/* Маркер центра зоны — drag = смещение центра. */}
        <Marker
          position={[centerLat, centerLon]}
          draggable
          icon={centerIcon}
          eventHandlers={{
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              onCenterChange(ll.lat, ll.lng);
            },
          }}
        />

        {/* Handle радиуса на восточной границе — drag = новый радиус. */}
        <Marker
          position={[handleLat, handleLon]}
          draggable
          icon={handleIcon}
          eventHandlers={{
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const newRadius = Math.round(haversineM(centerLat, centerLon, ll.lat, ll.lng));
              onRadiusChange(Math.max(50, Math.min(5000, newRadius)));
            },
          }}
        />
      </MapContainer>
    </div>
  );
}
