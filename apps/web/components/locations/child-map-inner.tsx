'use client';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  YMap,
  YMapComponentsProvider,
  YMapDefaultSchemeLayer,
  YMapDefaultFeaturesLayer,
  YMapControls,
  YMapControlButton,
  YMapZoomControl,
  YMapListener,
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
const FOLLOW_ZOOM = 15;
// После последнего взаимодействия родителя с картой — сколько держим её без
// авто-центровки. 15 сек — компромисс: достаточно чтобы посмотреть карту,
// недостаточно чтобы забыть про ребёнка.
const IDLE_RESUME_MS = 15_000;

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
  childName,
  latest,
  track,
  onMapError,
}: ChildMapInnerProps): ReactElement {
  const apiKey = process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY ?? '';

  // Начальное значение — track bounds / latest / дефолт. Дальше карта
  // управляется через setLocation (см. followChild-эффект ниже).
  const initialLocation = useMemo(
    () => initialLocationFor(latest, track),
    // Вычисляем один раз на маунт: нужно именно initial.
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

  const [followChild, setFollowChild] = useState(true);
  const [location, setLocation] = useState<MapLocation>(initialLocation);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Защита от ложных срабатываний onActionStart, когда сами программно
  // двигаем карту (setLocation при новой точке latest).
  const suppressActionRef = useRef(false);

  // Follow: при каждой новой точке latest (если пользователь не трогает карту)
  // центрируем её на ребёнке.
  useEffect(() => {
    if (followChild && latest) {
      suppressActionRef.current = true;
      setLocation({ center: [latest.lon, latest.lat], zoom: FOLLOW_ZOOM });
      // Action от программного setLocation прилетит в следующем tick.
      setTimeout(() => {
        suppressActionRef.current = false;
      }, 600);
    }
  }, [followChild, latest]);

  useEffect(
    () => () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!apiKey) onMapError();
  }, [apiKey, onMapError]);

  if (!apiKey) return <></>;

  const handleActionStart = (): void => {
    if (suppressActionRef.current) return;
    setFollowChild(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  };

  const handleActionEnd = (): void => {
    if (suppressActionRef.current) return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setFollowChild(true);
    }, IDLE_RESUME_MS);
  };

  const centerOnChild = (): void => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setFollowChild(true);
    if (latest) {
      suppressActionRef.current = true;
      setLocation({ center: [latest.lon, latest.lat], zoom: FOLLOW_ZOOM });
      setTimeout(() => {
        suppressActionRef.current = false;
      }, 600);
    }
  };

  return (
    <YMapComponentsProvider apiKey={apiKey} lang="ru_RU" onError={() => onMapError()}>
      <YMap location={location as any} className="h-full w-full">
        <YMapDefaultSchemeLayer />
        <YMapDefaultFeaturesLayer />
        <YMapListener
          onActionStart={handleActionStart as any}
          onActionEnd={handleActionEnd as any}
        />
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
