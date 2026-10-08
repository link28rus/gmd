'use client';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { MapContainer, TileLayer, useMap, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import type { PhoneLatest, PhoneTrackPoint } from '@/lib/api/find-phone';
import { useTheme } from '@/components/theme/theme-provider';
import { tileConfigFor } from '@/lib/maps/tile-config';
import { TrackPolyline } from '@/components/locations/track-polyline';
import { PhoneMarker } from './phone-marker';

export interface PhoneMapInnerProps {
  /** Ключ «вида»: при смене (другой телефон / другой день) карта заново подгоняется. */
  viewKey: string;
  phoneName: string;
  latest: PhoneLatest | null;
  ringing: boolean;
  /** Маршрут выбранного дня (сырые точки; грубые TrackPolyline отфильтрует сам). */
  track: PhoneTrackPoint[];
  /** Точки, которые реально рисуются, — по ним подгоняем масштаб. */
  drawable: PhoneTrackPoint[];
  /** Маршрут ещё грузится — подгонку масштаба откладываем до ответа. */
  trackLoading: boolean;
}

const DEFAULT_CENTER: [number, number] = [55.7558, 37.6173]; // Москва
const DEFAULT_ZOOM = 10;
const FOLLOW_ZOOM = 16;

/**
 * Подгоняет карту один раз на каждый viewKey: под маршрут дня, если в нём
 * есть хотя бы 2 точки, иначе — на последнюю точку телефона. Повторные опросы
 * (каждые 5–30 с) вид не трогают, чтобы не сбивать ручной зум/панорамирование.
 */
function FitView({
  viewKey,
  latest,
  drawable,
  trackLoading,
}: Pick<PhoneMapInnerProps, 'viewKey' | 'latest' | 'drawable' | 'trackLoading'>): null {
  const map = useMap();
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (trackLoading || fittedKey.current === viewKey) return;
    if (drawable.length >= 2) {
      const bounds = L.latLngBounds(drawable.map((p) => [p.lat, p.lon] as [number, number]));
      if (latest) bounds.extend([latest.lat, latest.lon]);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: FOLLOW_ZOOM });
    } else if (latest) {
      map.setView([latest.lat, latest.lon], FOLLOW_ZOOM);
    } else {
      return;
    }
    fittedKey.current = viewKey;
  }, [viewKey, latest, drawable, trackLoading, map]);
  return null;
}

/** Кнопка «К телефону» под зумом — как «К ребёнку» на карте ребёнка. */
function GoToPhoneControl({ latest }: { latest: PhoneLatest | null }): ReactElement | null {
  const map = useMap();
  if (!latest) return null;
  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'auto' }}>
      <div className="leaflet-control leaflet-bar" style={{ marginTop: 80, marginRight: 10 }}>
        <a
          href="#"
          role="button"
          aria-label="К телефону"
          title="К телефону"
          onClick={(e) => {
            e.preventDefault();
            map.flyTo([latest.lat, latest.lon], FOLLOW_ZOOM, { duration: 0.4 });
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

export function PhoneMapInner({
  viewKey,
  phoneName,
  latest,
  ringing,
  track,
  drawable,
  trackLoading,
}: PhoneMapInnerProps): ReactElement {
  const { theme } = useTheme();
  const tile = tileConfigFor(theme);

  // Стартовый вид — на последнюю точку; точную подгонку делает FitView.
  const initial = useMemo(
    (): { center: [number, number]; zoom: number } =>
      latest
        ? { center: [latest.lat, latest.lon], zoom: FOLLOW_ZOOM }
        : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <MapContainer
      center={initial.center}
      zoom={initial.zoom}
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
      <GoToPhoneControl latest={latest} />
      <FitView viewKey={viewKey} latest={latest} drawable={drawable} trackLoading={trackLoading} />
      <TrackPolyline items={track} />
      {latest && (
        <PhoneMarker
          lat={latest.lat}
          lon={latest.lon}
          accuracy={latest.accuracy}
          name={phoneName}
          ageSec={latest.ageSec}
          ringing={ringing}
        />
      )}
    </MapContainer>
  );
}
