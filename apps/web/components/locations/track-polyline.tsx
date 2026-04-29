'use client';
import { useMemo, type ReactElement } from 'react';
import { Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import type { LocationDto, TripDto } from '@/lib/api/locations';
import { douglasPeucker } from '@/lib/geo/douglas-peucker';

interface Props {
  items: LocationDto[];
  /**
   * Завершённые "поездки" ребёнка. Если передано — между поездками рисуем
   * крупный маркер-кружок "Стоял 13:05 – 15:20 (2ч 15мин)" вместо пучка
   * точек. Без stops ведём себя как раньше (всё рисуем как polyline+точки).
   */
  stops?: TripDto[];
}

// v0.31.0 — клиентская фильтрация GPS-шума. Работает поверх бэкендного
// accuracy floor (100м) и мобильного gate (75м); для ухоженных треков
// — второй слой защиты на уже накопленных старыми версиями данных.
const UI_ACCURACY_GATE_M = 50;

// Epsilon для Ramer–Douglas–Peucker. 10м = полтора автомобиля — мельче
// не имеет смысла на городской карте, а визуально убирает дрожь.
const DP_EPSILON_M = 10;

// Чтобы не перегружать карту при больших треках, показываем кружочки
// каждую N-ю точку. Первая и последняя — всегда.
const MAX_DOTS = 120;

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function durationRu(fromIso: string, toIso: string | null): string {
  const end = toIso ? new Date(toIso).getTime() : Date.now();
  const ms = end - new Date(fromIso).getTime();
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

function sampleForDots(items: LocationDto[]): LocationDto[] {
  if (items.length <= MAX_DOTS) return items;
  const step = Math.ceil(items.length / MAX_DOTS);
  const out: LocationDto[] = [];
  for (let i = 0; i < items.length; i += step) out.push(items[i]);
  if (out[out.length - 1] !== items[items.length - 1]) {
    out.push(items[items.length - 1]);
  }
  return out;
}

const dotIcon = (bg: string, border: string, size = 12): L.DivIcon =>
  L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${border};background:${bg};box-shadow:0 1px 2px rgba(0,0,0,0.2);transform:translate(-50%,-50%);position:absolute;left:0;top:0;"></div>`,
    className: 'gmd-dot',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

const stopIcon = (label: string, title: string): L.DivIcon =>
  L.divIcon({
    html: `<div title="${escapeAttr(title)}" style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:2px solid #f59e0b;background:#fffbeb;box-shadow:0 1px 2px rgba(0,0,0,0.2);font-size:10px;font-weight:600;color:#b45309;transform:translate(-50%,-50%);position:absolute;left:0;top:0;">${escapeHtml(label)}</div>`,
    className: 'gmd-stop',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

export function TrackPolyline({ items, stops }: Props): ReactElement | null {
  // Шаг 1: accuracy-фильтр.
  const filtered = useMemo(
    () => items.filter((p) => p.accuracy == null || p.accuracy <= UI_ACCURACY_GATE_M),
    [items],
  );

  // Шаг 2: DP-упрощение по всему отфильтрованному треку.
  // Возвращаем [lat, lon] — у leaflet порядок именно такой.
  const simplified = useMemo<Array<[number, number]>>(() => {
    if (filtered.length < 2) return [];
    const lonLat: Array<[number, number]> = filtered.map((p) => [p.lon, p.lat]);
    const dp = douglasPeucker(lonLat, DP_EPSILON_M);
    return dp.map(([lon, lat]) => [lat, lon]);
  }, [filtered]);

  const stopMarkers = useMemo(() => {
    if (!stops || stops.length === 0) return [] as TripDto[];
    return stops.filter((t) => !t.isActive);
  }, [stops]);

  if (simplified.length < 2 && stopMarkers.length === 0) return null;

  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  const dots = sampleForDots(filtered);

  return (
    <>
      {simplified.length >= 2 && (
        <Polyline
          positions={simplified}
          pathOptions={{ color: '#2563eb', weight: 3, dashArray: '8 6' }}
        />
      )}
      {stopMarkers.length === 0 &&
        dots.map((p, i) => {
          if (p === first || p === last) return null;
          return (
            <Marker
              key={`${p.recordedAt}-${i}`}
              position={[p.lat, p.lon]}
              icon={dotIcon('var(--card, #ffffff)', '#2563eb', 10)}
              title={hhmm(p.recordedAt)}
            />
          );
        })}
      {stopMarkers.map((t) => {
        const endedAt = t.endedAt ?? t.startedAt;
        const title = `Был тут в ${hhmm(endedAt)} · поездка ${durationRu(t.startedAt, t.endedAt)}`;
        return (
          <Marker
            key={`stop-${t.id}`}
            position={[t.endLat, t.endLon]}
            icon={stopIcon('П', title)}
            title={title}
          />
        );
      })}
      {first && (
        <Marker
          position={[first.lat, first.lon]}
          icon={dotIcon('#16a34a', '#ffffff', 12)}
          title={`Начало: ${hhmm(first.recordedAt)}`}
        />
      )}
      {last && last !== first && (
        <Marker
          position={[last.lat, last.lon]}
          icon={dotIcon('#dc2626', '#ffffff', 12)}
          title={`Конец: ${hhmm(last.recordedAt)}`}
        />
      )}
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
