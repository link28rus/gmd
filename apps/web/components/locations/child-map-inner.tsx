'use client';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { MapContainer, TileLayer, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import type { LatestLocationDto, LocationDto, TripDto } from '@/lib/api/locations';
import { useTheme } from '@/components/theme/theme-provider';
import { tileConfigFor } from '@/lib/maps/tile-config';
import { LatestMarker } from './latest-marker';
import { TrackPolyline } from './track-polyline';

export interface ChildMapInnerProps {
  childId: string;
  childName: string;
  latest: LatestLocationDto | null;
  track: LocationDto[];
  /** Сохранён в API ради обратной совместимости с обёрткой ChildMap. */
  onMapError: () => void;
  stops?: TripDto[];
}

const DEFAULT_CENTER: [number, number] = [55.7558, 37.6173]; // Москва
const DEFAULT_ZOOM = 10;
const FOLLOW_ZOOM = 15;

function initialView(
  latest: LatestLocationDto | null,
  track: LocationDto[],
): { center: [number, number]; zoom: number; bounds?: L.LatLngBoundsExpression } {
  if (track.length >= 2) {
    const lats = track.map((p) => p.lat);
    const lons = track.map((p) => p.lon);
    const south = Math.min(...lats);
    const north = Math.max(...lats);
    const west = Math.min(...lons);
    const east = Math.max(...lons);
    const center: [number, number] = [(south + north) / 2, (west + east) / 2];
    return {
      center,
      zoom: FOLLOW_ZOOM,
      bounds: [
        [south, west],
        [north, east],
      ],
    };
  }
  if (latest) return { center: [latest.lat, latest.lon], zoom: FOLLOW_ZOOM };
  return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

/** Императивно центрирует карту, когда меняется выбранный ребёнок. */
function FollowChild({
  childId,
  latest,
}: {
  childId: string;
  latest: LatestLocationDto | null;
}): null {
  const map = useMap();
  const [lastChild, setLastChild] = useState<string | null>(null);
  useEffect(() => {
    if (latest && lastChild !== childId) {
      map.flyTo([latest.lat, latest.lon], FOLLOW_ZOOM, { duration: 0.6 });
      setLastChild(childId);
    }
  }, [childId, latest, lastChild, map]);
  return null;
}

/** Кастомная кнопка «К ребёнку». Leaflet нативный Control через React-обёртку. */
function GoToChildControl({ latest }: { latest: LatestLocationDto | null }): ReactElement | null {
  const map = useMap();
  const onClick = (): void => {
    if (latest) map.flyTo([latest.lat, latest.lon], FOLLOW_ZOOM, { duration: 0.4 });
  };
  if (!latest) return null;
  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'auto' }}>
      <div className="leaflet-control leaflet-bar" style={{ marginTop: 80, marginRight: 10 }}>
        <a
          href="#"
          role="button"
          aria-label="К ребёнку"
          title="К ребёнку"
          onClick={(e) => {
            e.preventDefault();
            onClick();
          }}
          className="!flex h-[30px] w-[30px] items-center justify-center bg-card text-foreground"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
        </a>
      </div>
    </div>
  );
}

export function ChildMapInner({
  childId,
  childName,
  latest,
  track,
  stops,
}: ChildMapInnerProps): ReactElement {
  const { theme } = useTheme();
  const tile = tileConfigFor(theme);

  // Чиним default Leaflet marker icons, которые иначе ищут assets по
  // неправильному пути в Webpack-сборке. Используем CDN unpkg как fallback.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });
  }, []);

  const view = useMemo(() => initialView(latest, track), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MapContainer
      center={view.center}
      zoom={view.zoom}
      bounds={view.bounds}
      className="h-full w-full"
      zoomControl={false}
      attributionControl
    >
      <TileLayer
        key={tile.url}
        url={tile.url}
        attribution={tile.attribution}
        maxZoom={tile.maxZoom}
      />
      <ZoomControl position="topright" />
      <GoToChildControl latest={latest} />
      <FollowChild childId={childId} latest={latest} />
      {latest && (
        <LatestMarker
          lat={latest.lat}
          lon={latest.lon}
          accuracy={latest.accuracy}
          childName={childName}
          ageSec={latest.ageSec}
        />
      )}
      <TrackPolyline items={track} stops={stops} />
    </MapContainer>
  );
}
