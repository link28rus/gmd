// apps/web/app/cabinet/zones/components/zones-map-inner.tsx
'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import { LocateFixed } from 'lucide-react';
import { toast } from 'sonner';
import type { Zone } from '@/lib/api/zones';
import type { FamilyLatestItem, FamilyLatestParent } from '@/lib/api/locations';
import { geoApi } from '@/lib/api/geocode';
import { useTheme } from '@/components/theme/theme-provider';
import { tileConfigFor } from '@/lib/maps/tile-config';
import { useChildAvatarSrc } from '@/lib/hooks/use-child-avatar';
import { formatAgeShort } from '@/lib/date/age-format';
import { LatestMarker } from '@/components/locations/latest-marker';
import { ParentMarker } from '@/components/locations/parent-marker';
import { mapViewStorageKey, readSavedMapView, writeSavedMapView } from './zone-format';

export interface MapKid {
  id: string;
  name: string;
  avatarKey?: string | null;
}

export interface MapViewState {
  lat: number;
  lon: number;
  zoom: number;
}

export interface ZonesMapInnerProps {
  zones: Zone[];
  kids: MapKid[];
  /** Последние точки детей (`/family/locations/latest`). */
  latest: FamilyLatestItem[];
  /** Запрос точек детей завершён (успехом или ошибкой) — можно выставлять стартовый вид. */
  latestReady: boolean;
  /** Для ключа запомненного вида карты; без него вид не запоминается. */
  userId: string | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Показывать круги зон. По умолчанию — да. */
  showZones?: boolean;
  /** Двойной клик по карте (lat, lon). */
  onMapDblClick?: (lat: number, lon: number) => void;
  /** Текущий вид карты — после стартового позиционирования и на каждом moveend. */
  onViewChange?: (v: MapViewState) => void;
  /** «Создать зону здесь» из попапа ребёнка. */
  onCreateAtChild?: (childId: string, lat: number, lon: number) => void;
  /** Запрос «показать точку» извне (клик по ребёнку в списке); seq меняется на каждый запрос. */
  focus?: { lat: number; lon: number; seq: number } | null;
  /** v0.70.0: метки родителей семьи (общая карта «Все»); по умолчанию — нет. */
  parents?: FamilyLatestParent[];
  /** v0.70.0: клик по метке ребёнка — вместо попапа (общая карта: переход к ребёнку). */
  onKidClick?: (childId: string) => void;
}

interface MapPoint {
  lat: number;
  lon: number;
}

const NO_PARENTS: FamilyLatestParent[] = [];

const MOSCOW: [number, number] = [55.7558, 37.6173];
const MOSCOW_ZOOM = 10;
const IP_ZOOM = 11;
// Сверху запас под маркер ребёнка: аватар и плашка «Был тут…» стоят над точкой (~90 px).
const FIT_OPTIONS: L.FitBoundsOptions = {
  paddingTopLeft: [40, 110],
  paddingBottomRight: [40, 40],
  maxZoom: 16,
};
const DBIP_ATTRIBUTION =
  'IP Geolocation by <a href="https://db-ip.com" target="_blank" rel="noopener">DB-IP</a>';

function zoneBounds(z: Zone): L.LatLngBounds {
  // toBounds(size) — квадрат со стороной size метров вокруг точки.
  return L.latLng(z.centerLat, z.centerLon).toBounds(z.radius * 2);
}

/** Границы кругов зон + точек детей (и родителей); null — нечего показывать. */
function contentBounds(zones: Zone[], points: MapPoint[]): L.LatLngBounds | null {
  let b: L.LatLngBounds | null = null;
  for (const z of zones) {
    const zb = zoneBounds(z);
    b = b ? b.extend(zb) : zb;
  }
  for (const p of points) {
    const ll = L.latLng(p.lat, p.lon);
    b = b ? b.extend(ll) : L.latLngBounds(ll, ll);
  }
  return b;
}

/**
 * Стартовый вид карты — ОДИН раз, когда данные загружены:
 * (а) зоны или точки детей → fitBounds; (б) запомненный вид; (в) город по IP
 * (+ подпись DB-IP); (г) Москва. Последующие refetch вид не трогают.
 * Вид запоминается только после действий пользователя (drag/zoom/клавиатура),
 * программные перелёты стартовой цепочки не сохраняются.
 */
function InitialViewController({
  ready,
  zones,
  points,
  storageKey,
  onViewChange,
}: {
  ready: boolean;
  zones: Zone[];
  points: MapPoint[];
  storageKey: string | null;
  onViewChange?: (v: MapViewState) => void;
}): null {
  const map = useMap();
  const doneRef = useRef(false);
  const userMovedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  // Любое прикосновение пользователя к карте = дальше вид «его», запоминаем.
  useEffect(() => {
    const el = map.getContainer();
    const mark = (): void => {
      userMovedRef.current = true;
    };
    const events = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const;
    for (const ev of events) el.addEventListener(ev, mark, { passive: true });
    return () => {
      for (const ev of events) el.removeEventListener(ev, mark);
    };
  }, [map]);

  useMapEvents({
    moveend() {
      const c = map.getCenter();
      const view = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
      onViewChangeRef.current?.(view);
      if (!storageKey || !userMovedRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => writeSavedMapView(storageKey, view), 500);
    },
  });

  // Отдельный флаг размонтирования: cleanup основного эффекта срабатывает и на
  // обычных ре-рендерах (points — новый массив), он не должен отменять запрос IP.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ready || doneRef.current) return;
    doneRef.current = true;
    const report = (): void => {
      const c = map.getCenter();
      onViewChangeRef.current?.({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
    };
    // Пользователь уже сам двигал карту, пока грузились точки, — не перебиваем.
    if (userMovedRef.current) {
      report();
      return;
    }

    const bounds = contentBounds(zones, points);
    if (bounds) {
      map.fitBounds(bounds, FIT_OPTIONS);
      report();
      return;
    }
    const saved = readSavedMapView(storageKey);
    if (saved) {
      map.setView([saved.lat, saved.lon], saved.zoom);
      report();
      return;
    }
    geoApi
      .ipCenter()
      .then((c) => {
        if (!aliveRef.current || userMovedRef.current) return;
        if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
          map.setView([c.lat, c.lon], IP_ZOOM);
          map.attributionControl?.addAttribution(DBIP_ATTRIBUTION);
        } else {
          map.setView(MOSCOW, MOSCOW_ZOOM);
        }
        report();
      })
      .catch(() => {
        if (!aliveRef.current || userMovedRef.current) return;
        map.setView(MOSCOW, MOSCOW_ZOOM);
        report();
      });
  }, [ready, zones, points, storageKey, map]);

  return null;
}

/** Выбрали зону в списке, а её не видно — плавно показать. */
function FocusSelectedZone({
  zones,
  selectedId,
}: {
  zones: Zone[];
  selectedId?: string | null;
}): null {
  const map = useMap();
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || lastRef.current === selectedId) {
      lastRef.current = selectedId ?? null;
      return;
    }
    lastRef.current = selectedId;
    const zone = zones.find((z) => z.id === selectedId);
    if (!zone) return;
    const b = zoneBounds(zone);
    if (!map.getBounds().contains(b)) map.flyToBounds(b, { ...FIT_OPTIONS, duration: 0.6 });
  }, [selectedId, zones, map]);
  return null;
}

/** Внешний запрос «показать точку» (например, клик по ребёнку в блоке «Дети»). */
function FocusPoint({ focus }: { focus?: ZonesMapInnerProps['focus'] }): null {
  const map = useMap();
  const seqRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || seqRef.current === focus.seq) return;
    seqRef.current = focus.seq;
    map.flyTo([focus.lat, focus.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [focus, map]);
  return null;
}

function MapDblClickListener({
  onDblClick,
}: {
  onDblClick?: (lat: number, lon: number) => void;
}): null {
  useMapEvents({
    dblclick(e) {
      onDblClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function locateErrorText(code: number): string {
  switch (code) {
    case 1:
      return 'Браузер не дал доступ к геолокации. Разрешите его в настройках сайта и попробуйте снова.';
    case 2:
      return 'Не удалось определить ваше местоположение.';
    case 3:
      return 'Определение местоположения заняло слишком много времени. Попробуйте ещё раз.';
    default:
      return 'Геолокация недоступна в этом браузере.';
  }
}

/**
 * Кнопка «Где я»: геолокация браузера ТОЛЬКО по нажатию (при загрузке не
 * спрашиваем). Свои обработчики locationfound/locationerror, временная отметка
 * с кругом точности.
 */
function LocateMeControl(): ReactElement {
  const map = useMap();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [locating, setLocating] = useState(false);
  const [me, setMe] = useState<{ lat: number; lon: number; acc: number } | null>(null);

  // Клики/двойные клики по кнопке не должны доходить до карты (dblclick = новая зона).
  useEffect(() => {
    if (!wrapRef.current) return;
    L.DomEvent.disableClickPropagation(wrapRef.current);
    L.DomEvent.disableScrollPropagation(wrapRef.current);
  }, []);

  useEffect(() => {
    const onFound = (e: L.LocationEvent): void => {
      setLocating(false);
      setMe({ lat: e.latlng.lat, lon: e.latlng.lng, acc: e.accuracy });
      map.flyTo(e.latlng, Math.max(map.getZoom(), 16), { duration: 0.8 });
    };
    const onError = (e: L.ErrorEvent): void => {
      setLocating(false);
      toast.error(locateErrorText(e.code));
    };
    map.on('locationfound', onFound);
    map.on('locationerror', onError);
    return () => {
      map.off('locationfound', onFound);
      map.off('locationerror', onError);
      map.stopLocate();
    };
  }, [map]);

  // Отметка временная: через минуту убираем.
  useEffect(() => {
    if (!me) return;
    const t = setTimeout(() => setMe(null), 60_000);
    return () => clearTimeout(t);
  }, [me]);

  const onClick = (): void => {
    if (locating) return;
    setLocating(true);
    map.locate({ setView: false, watch: false, enableHighAccuracy: true, timeout: 15_000 });
  };

  return (
    <>
      <div className="leaflet-top leaflet-right" style={{ pointerEvents: 'auto' }}>
        <div
          ref={wrapRef}
          className="leaflet-control leaflet-bar"
          style={{ marginTop: 80, marginRight: 10 }}
        >
          <a
            href="#"
            role="button"
            aria-label="Где я"
            title="Где я"
            aria-busy={locating}
            onClick={(e) => {
              e.preventDefault();
              onClick();
            }}
            className="!flex h-[30px] w-[30px] items-center justify-center bg-card text-foreground"
          >
            <LocateFixed className={locating ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
          </a>
        </div>
      </div>
      {me && (
        <>
          <Circle
            center={[me.lat, me.lon]}
            radius={me.acc}
            interactive={false}
            pathOptions={{ color: '#0ea5e9', weight: 1, fillColor: '#0ea5e9', fillOpacity: 0.1 }}
          />
          <CircleMarker
            center={[me.lat, me.lon]}
            radius={7}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#0ea5e9', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              Вы здесь (±{Math.round(me.acc)} м)
            </Tooltip>
          </CircleMarker>
        </>
      )}
    </>
  );
}

/**
 * Маркер ребёнка с попапом «Создать зону здесь». С `onClick` (общая карта
 * семьи) попапа нет — клик сразу ведёт к ребёнку.
 */
function KidMarker({
  kid,
  point,
  onCreateAt,
  onClick,
}: {
  kid: MapKid;
  point: FamilyLatestItem;
  onCreateAt?: (childId: string, lat: number, lon: number) => void;
  onClick?: (childId: string) => void;
}): ReactElement {
  const avatarUrl = useChildAvatarSrc(kid.id, kid.avatarKey);
  const kidId = kid.id;
  const handleClick = useCallback(() => onClick?.(kidId), [onClick, kidId]);
  if (onClick) {
    return (
      <LatestMarker
        lat={point.lat}
        lon={point.lon}
        accuracy={point.accuracy}
        childName={kid.name}
        ageSec={point.ageSec}
        avatarUrl={avatarUrl}
        onClick={handleClick}
      />
    );
  }
  return (
    <LatestMarker
      lat={point.lat}
      lon={point.lon}
      accuracy={point.accuracy}
      childName={kid.name}
      ageSec={point.ageSec}
      avatarUrl={avatarUrl}
    >
      <Popup
        offset={[0, -84]}
        className="[&_.leaflet-popup-content-wrapper]:bg-card [&_.leaflet-popup-content-wrapper]:text-card-foreground [&_.leaflet-popup-tip]:bg-card"
      >
        <div className="space-y-2">
          <div>
            <p className="m-0 text-sm font-semibold">{kid.name}</p>
            <p className="m-0 text-xs text-muted-foreground">
              Точка {formatAgeShort(point.ageSec)}
              {point.accuracy !== null ? ` · ±${Math.round(point.accuracy)} м` : ''}
            </p>
          </div>
          {onCreateAt && (
            <button
              type="button"
              onClick={() => onCreateAt(kid.id, point.lat, point.lon)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Создать зону здесь
            </button>
          )}
        </div>
      </Popup>
    </LatestMarker>
  );
}

type InitialProps =
  | { center: [number, number]; zoom: number; bounds?: undefined; boundsOptions?: undefined }
  | {
      center?: undefined;
      zoom?: undefined;
      bounds: L.LatLngBounds;
      boundsOptions: L.FitBoundsOptions;
    };

/** Вид при монтировании (до загрузки точек детей), чтобы не мигать Москвой. */
function mountView(zones: Zone[], storageKey: string | null): InitialProps {
  const b = contentBounds(zones, []);
  if (b) return { bounds: b, boundsOptions: FIT_OPTIONS };
  const saved = readSavedMapView(storageKey);
  if (saved) return { center: [saved.lat, saved.lon], zoom: saved.zoom };
  return { center: MOSCOW, zoom: MOSCOW_ZOOM };
}

export function ZonesMapInner({
  zones,
  kids,
  latest,
  latestReady,
  userId,
  selectedId,
  onSelect,
  showZones = true,
  onMapDblClick,
  onViewChange,
  onCreateAtChild,
  focus,
  parents = NO_PARENTS,
  onKidClick,
}: ZonesMapInnerProps): ReactElement {
  const { theme } = useTheme();
  const tile = tileConfigFor(theme);
  const storageKey = userId ? mapViewStorageKey(userId) : null;
  // Стартовая позиция считается один раз; дальше вид ведёт InitialViewController.
  const [initial] = useState(() => mountView(zones, storageKey));

  const kidsById = new Map(kids.map((k) => [k.id, k]));
  const kidPoints = latest.filter((p) => kidsById.has(p.childId));
  const viewPoints: MapPoint[] = parents.length > 0 ? [...kidPoints, ...parents] : kidPoints;

  return (
    <MapContainer
      {...initial}
      className="h-full w-full"
      zoomControl={false}
      doubleClickZoom={!onMapDblClick}
    >
      <TileLayer
        key={tile.url}
        url={tile.url}
        attribution={tile.attribution}
        maxZoom={tile.maxZoom}
      />
      <ZoomControl position="topright" />
      <LocateMeControl />
      <MapDblClickListener onDblClick={onMapDblClick} />
      <InitialViewController
        ready={latestReady}
        zones={zones}
        points={viewPoints}
        storageKey={storageKey}
        onViewChange={onViewChange}
      />
      <FocusSelectedZone zones={zones} selectedId={selectedId} />
      <FocusPoint focus={focus} />

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
            >
              <Tooltip direction="top" sticky>
                {zone.name}
              </Tooltip>
            </Circle>
          );
        })}

      {parents.map((p) => (
        <ParentMarker
          key={`parent-${p.userId}`}
          lat={p.lat}
          lon={p.lon}
          accuracy={p.accuracy}
          name={p.name}
          ageSec={p.ageSec}
          isMe={p.isMe}
        />
      ))}

      {kidPoints.map((p) => {
        const kid = kidsById.get(p.childId);
        if (!kid) return null;
        return (
          <KidMarker
            key={p.childId}
            kid={kid}
            point={p}
            onCreateAt={onCreateAtChild}
            onClick={onKidClick}
          />
        );
      })}
    </MapContainer>
  );
}
