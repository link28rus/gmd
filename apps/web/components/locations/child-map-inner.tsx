'use client';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  YMap,
  YMapComponentsProvider,
  YMapDefaultSchemeLayer,
  YMapDefaultFeaturesLayer,
  YMapControls,
  YMapControlButton,
  YMapZoomControl,
} from 'ymap3-components';
import type { LatestLocationDto, LocationDto } from '@/lib/api/locations';
import { LatestMarker } from './latest-marker';
import { TrackPolyline } from './track-polyline';
import { useTheme } from '@/components/theme/theme-provider';

export interface ChildMapInnerProps {
  childId: string;
  childName: string;
  latest: LatestLocationDto | null;
  track: LocationDto[];
  onMapError: () => void;
}

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const DEFAULT_ZOOM = 10;
const FOLLOW_ZOOM = 15;

type MapLocation =
  | { center: [number, number]; zoom: number }
  | { bounds: [[number, number], [number, number]] };

function initialLocationFor(latest: LatestLocationDto | null, track: LocationDto[]): MapLocation {
  if (track.length >= 2) {
    const lons = track.map((p) => p.lon);
    const lats = track.map((p) => p.lat);
    return {
      bounds: [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
    };
  }
  if (latest) return { center: [latest.lon, latest.lat], zoom: FOLLOW_ZOOM };
  return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM };
}

export function ChildMapInner({
  childId,
  childName,
  latest,
  track,
  onMapError,
}: ChildMapInnerProps): ReactElement {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? '';
  const { theme } = useTheme();
  // Yandex Maps поддерживает только light/dark — dim-тему UI склеиваем с dark,
  // чтобы карта не резала глаза светлыми тайлами на приглушённом интерфейсе.
  const mapTheme: 'light' | 'dark' = theme === 'light' ? 'light' : 'dark';

  // Начальная позиция — track bounds / latest / дефолт. Дальше карта
  // управляется только вручную: перемещение пользователем или клик по кнопке
  // «К ребёнку». Автоследование за ребёнком отключено намеренно — родители
  // жаловались, что карта «выдёргивала» обзор при каждом апдейте локации.
  const initialLocation = useMemo(
    () => initialLocationFor(latest, track),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Иконка для кнопки «К ребёнку». Yandex YMapControlButton рендерит или text,
  // или element (HTMLElement) — React children там не работают. Создаём span
  // с SVG-навигацией (тот же icon-pack что lucide Navigation).
  const centerIconEl = useMemo<HTMLElement | undefined>(() => {
    if (typeof document === 'undefined') return undefined;
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    span.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" ' +
      'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
    return span;
  }, []);

  const [location, setLocation] = useState<MapLocation>(initialLocation);

  useEffect(() => {
    if (!apiKey) onMapError();
  }, [apiKey, onMapError]);

  // При переключении ребёнка в сайдбаре — центрируем карту на выбранном
  // ребёнке, как только приходят его координаты. Срабатывает один раз на
  // смену childId: последующие апдейты latest (каждые 5 с) карту не двигают.
  const [lastCenteredChildId, setLastCenteredChildId] = useState<string | null>(null);
  useEffect(() => {
    if (latest && lastCenteredChildId !== childId) {
      setLocation({ center: [latest.lon, latest.lat], zoom: FOLLOW_ZOOM });
      setLastCenteredChildId(childId);
    }
  }, [childId, latest, lastCenteredChildId]);

  if (!apiKey) return <></>;

  const centerOnChild = (): void => {
    if (latest) {
      setLocation({ center: [latest.lon, latest.lat], zoom: FOLLOW_ZOOM });
    }
  };

  return (
    <YMapComponentsProvider apiKey={apiKey} lang="ru_RU" onError={() => onMapError()}>
      <YMap location={location as any} className="h-full w-full">
        <YMapDefaultSchemeLayer theme={mapTheme} />
        <YMapDefaultFeaturesLayer />
        <YMapControls position="right">
          <YMapZoomControl />
          <YMapControlButton onClick={centerOnChild} element={centerIconEl} />
        </YMapControls>
        {latest && (
          <LatestMarker
            lat={latest.lat}
            lon={latest.lon}
            accuracy={latest.accuracy}
            childName={childName}
            ageSec={latest.ageSec}
          />
        )}
        <TrackPolyline items={track} />
      </YMap>
    </YMapComponentsProvider>
  );
}
