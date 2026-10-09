'use client';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import L from 'leaflet';
import type { StayDto, TripPointDto } from '@/lib/api/locations';
import type { Zone } from '@/lib/api/zones';
import { useTheme } from '@/components/theme/theme-provider';
import { tileConfigFor } from '@/lib/maps/tile-config';
import { splitTrackByGaps } from '@/lib/geo/track-gaps';
import {
  ChildZonesLayer,
  useShowChildZones,
  ZonesToggleControl,
} from '@/components/locations/child-zones-layer';
import { fmtClock, fmtDurationMs, type DayTrip } from '@/lib/history/trip-history';

export interface TripTrack {
  points: TripPointDto[];
  stays: StayDto[];
}

export interface HistoryMapInnerProps {
  /** Ключ дня — при смене карта заново подгоняет масштаб. */
  dayKey: string;
  trips: DayTrip[];
  /** Точки поездок по id; undefined — ещё грузятся. */
  tracks: Record<string, TripTrack | undefined>;
  selectedId: string | null;
  onSelect: (tripId: string) => void;
  zones: Zone[];
}

const DEFAULT_CENTER: [number, number] = [55.7558, 37.6173];
/**
 * Сверху — место под плашку MapCard (у выбранной поездки она ~200 px), чтобы
 * она не закрывала маршрут. На низкой карте (телефон) столько места нет.
 */
function fitPadding(map: L.Map): L.FitBoundsOptions {
  const top = map.getSize().y > 520 ? 220 : 56;
  return { paddingTopLeft: [40, top], paddingBottomRight: [56, 40] };
}

// Разрыв в данных — серый пунктир, как на главной карте (track-polyline.tsx).
const GAP_PATH: L.PathOptions = { color: '#64748b', weight: 2, dashArray: '4 6' };

function startIcon(color: string, dim: boolean): L.DivIcon {
  return L.divIcon({
    html: `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,.35);opacity:${dim ? 0.45 : 1}"></div>`,
    className: 'gmd-trip-start',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function finishIcon(color: string, ordinal: number, dim: boolean, selected: boolean): L.DivIcon {
  const size = selected ? 26 : 22;
  return L.divIcon({
    html: `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;font:600 ${selected ? 13 : 11}px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;opacity:${dim ? 0.45 : 1}">${ordinal}</div>`,
    className: 'gmd-trip-finish',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

const stayIcon = L.divIcon({
  html: `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:20px;height:20px;border-radius:50%;border:2px solid #f59e0b;background:#fffbeb;box-shadow:0 1px 2px rgba(0,0,0,.2);color:#b45309;font:600 10px/16px system-ui,sans-serif;text-align:center">П</div>`,
  className: 'gmd-stop',
  iconSize: [0, 0],
  iconAnchor: [0, 0],
});

/**
 * Подгоняет масштаб под выбранную поездку или весь день. Смена выбора — плавный
 * перелёт; догрузка точек в том же выборе — мгновенная подгонка, иначе
 * анимации накладываются и маршрут оказывается за краем.
 */
function FitToTrips({
  dayKey,
  selectedId,
  bounds,
}: {
  dayKey: string;
  selectedId: string | null;
  bounds: L.LatLngBounds | null;
}): null {
  const map = useMap();
  const fitted = useRef<{ scope: string; bbox: string } | null>(null);
  useEffect(() => {
    if (!bounds) return;
    const scope = `${dayKey}|${selectedId ?? ''}`;
    const bbox = bounds.toBBoxString();
    const prev = fitted.current;
    // Повторно не подгоняем — родитель мог сам подвинуть карту.
    if (prev && prev.scope === scope && prev.bbox === bbox) return;
    fitted.current = { scope, bbox };
    map.stop();
    const opts = { ...fitPadding(map), maxZoom: 17 };
    if (prev && prev.scope !== scope) map.flyToBounds(bounds, { ...opts, duration: 0.5 });
    else map.fitBounds(bounds, { ...opts, animate: false });
  }, [map, dayKey, selectedId, bounds]);
  return null;
}

function TripLayer({
  item,
  track,
  selected,
  dim,
  casing,
  onSelect,
}: {
  item: DayTrip;
  track: TripTrack;
  selected: boolean;
  dim: boolean;
  /** Цвет обводки выбранного маршрута — под подложку темы. */
  casing: string;
  onSelect: (id: string) => void;
}): ReactElement | null {
  const { segments, gaps } = useMemo(() => splitTrackByGaps(track.points), [track.points]);
  const lines = useMemo(
    () =>
      segments
        .filter((s) => s.length >= 2)
        .map((s) => s.map((p): [number, number] => [p.lat, p.lon])),
    [segments],
  );
  const icons = useMemo(
    () => ({
      start: startIcon(item.color, dim),
      finish: finishIcon(item.color, item.ordinal, dim, selected),
    }),
    [item.color, item.ordinal, dim, selected],
  );
  if (track.points.length === 0) return null;
  const first = track.points[0];
  const last = track.points[track.points.length - 1];
  const handlers = { click: () => onSelect(item.trip.id) };
  const title = `Поездка ${item.ordinal} · ${fmtClock(item.trip.startedAt)}`;

  return (
    <>
      {selected &&
        lines.map((line, i) => (
          <Polyline
            key={`case-${i}`}
            positions={line}
            pathOptions={{ color: casing, weight: 9, opacity: 0.9, interactive: false }}
          />
        ))}
      {lines.map((line, i) => (
        <Polyline
          key={`line-${i}`}
          positions={line}
          eventHandlers={handlers}
          pathOptions={{
            color: item.color,
            weight: selected ? 5 : 4,
            opacity: dim ? 0.3 : 0.95,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        >
          <Tooltip sticky>{title}</Tooltip>
        </Polyline>
      ))}
      {!dim &&
        gaps.map((g, i) => (
          <Polyline
            key={`gap-${i}`}
            positions={[
              [g.from.lat, g.from.lon],
              [g.to.lat, g.to.lon],
            ]}
            pathOptions={GAP_PATH}
            interactive={false}
          />
        ))}
      {selected &&
        track.stays.map((s) => (
          <Marker key={`stay-${s.from}`} position={[s.lat, s.lon]} icon={stayIcon}>
            <Tooltip direction="top" offset={[0, -10]}>
              Стоял {fmtClock(s.from)}–{fmtClock(s.to)} ·{' '}
              {fmtDurationMs(new Date(s.to).getTime() - new Date(s.from).getTime())}
            </Tooltip>
          </Marker>
        ))}
      <Marker position={[first.lat, first.lon]} icon={icons.start} eventHandlers={handlers}>
        <Tooltip direction="top" offset={[0, -8]}>
          Начало поездки {item.ordinal} · {fmtClock(first.recordedAt)}
        </Tooltip>
      </Marker>
      <Marker
        position={[last.lat, last.lon]}
        icon={icons.finish}
        eventHandlers={handlers}
        zIndexOffset={selected ? 1000 : 0}
      >
        <Tooltip direction="top" offset={[0, -14]}>
          {item.trip.isActive ? 'Сейчас' : 'Конец'} поездки {item.ordinal} ·{' '}
          {fmtClock(last.recordedAt)}
        </Tooltip>
      </Marker>
    </>
  );
}

export function HistoryMapInner({
  dayKey,
  trips,
  tracks,
  selectedId,
  onSelect,
  zones,
}: HistoryMapInnerProps): ReactElement {
  const { theme } = useTheme();
  const tile = tileConfigFor(theme);
  const [showZones, setShowZones] = useShowChildZones();

  const bounds = useMemo(() => {
    const scope = selectedId ? trips.filter((t) => t.trip.id === selectedId) : trips;
    // Старт и финиш известны сразу, точки маршрута догружаются отдельно.
    const latLngs: L.LatLngExpression[] = [];
    for (const t of scope) {
      latLngs.push([t.trip.startLat, t.trip.startLon], [t.trip.endLat, t.trip.endLon]);
      for (const p of tracks[t.trip.id]?.points ?? []) latLngs.push([p.lat, p.lon]);
    }
    return latLngs.length > 0 ? L.latLngBounds(latLngs) : null;
  }, [trips, tracks, selectedId]);

  // Выбранную рисуем последней — поверх остальных.
  const ordered = useMemo(
    () =>
      [...trips].sort(
        (a, b) => Number(a.trip.id === selectedId) - Number(b.trip.id === selectedId),
      ),
    [trips, selectedId],
  );

  return (
    <MapContainer
      center={bounds?.getCenter() ?? DEFAULT_CENTER}
      zoom={13}
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
      {zones.length > 0 && (
        <ZonesToggleControl
          show={showZones}
          onToggle={() => setShowZones(!showZones)}
          marginTop={80}
        />
      )}
      {showZones && <ChildZonesLayer zones={zones} />}
      {ordered.map((item) => {
        const track = tracks[item.trip.id];
        if (!track) return null;
        const selected = item.trip.id === selectedId;
        return (
          <TripLayer
            key={item.trip.id}
            item={item}
            track={track}
            selected={selected}
            dim={selectedId !== null && !selected}
            casing={theme === 'light' ? '#ffffff' : '#0f172a'}
            onSelect={onSelect}
          />
        );
      })}
      <FitToTrips dayKey={dayKey} selectedId={selectedId} bounds={bounds} />
    </MapContainer>
  );
}
