'use client';
import { useMemo, type ReactElement } from 'react';
import { YMapFeature, YMapMarker } from 'ymap3-components';
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

export function TrackPolyline({ items, stops }: Props): ReactElement | null {
  // Шаг 1: accuracy-фильтр. Точки с accuracy > порога (или null — legacy) оставляем.
  // null означает что клиент не прислал поле — не пессимизируем.
  const filtered = useMemo(() => {
    return items.filter((p) => p.accuracy == null || p.accuracy <= UI_ACCURACY_GATE_M);
  }, [items]);

  // Шаг 2: DP-упрощение по всему отфильтрованному треку.
  const simplifiedCoords = useMemo<Array<[number, number]>>(() => {
    if (filtered.length < 2) return [];
    const coords: Array<[number, number]> = filtered.map((p) => [p.lon, p.lat]);
    return douglasPeucker(coords, DP_EPSILON_M);
  }, [filtered]);

  // stops рисуем всегда — даже если линии < 2 точек.
  const stopMarkers = useMemo(() => {
    if (!stops || stops.length === 0) return [] as TripDto[];
    // Стоянка между поездками рендерится как маркер в точке окончания поездки.
    // Активную (незакрытую) поездку игнорируем — у неё нет "конечной стоянки".
    return stops.filter((t) => !t.isActive);
  }, [stops]);

  if (simplifiedCoords.length < 2 && stopMarkers.length === 0) return null;

  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  const dots = sampleForDots(filtered);

  return (
    <>
      {simplifiedCoords.length >= 2 && (
        <YMapFeature
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          geometry={{ type: 'LineString', coordinates: simplifiedCoords } as any}
          style={
            {
              stroke: [{ color: '#2563eb', width: 3, dash: [8, 6] }],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
        />
      )}
      {/* Dots — показываем только если stops не предоставлены (fallback-режим).
          Когда stops есть, трек уже упрощён DP и крупные маркеры-стоянки
          визуально важнее отдельных точек-сэмплов. */}
      {stopMarkers.length === 0 &&
        dots.map((p, i) => {
          if (p === first || p === last) return null;
          return (
            <YMapMarker key={`${p.recordedAt}-${i}`} coordinates={[p.lon, p.lat]}>
              <div
                className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#2563eb] bg-card"
                title={hhmm(p.recordedAt)}
              />
            </YMapMarker>
          );
        })}
      {/* Stop markers (по данным /trips). Каждая завершённая поездка рисуется
          как крупный кружок в точке конца с подписью "прибыл в HH:MM".
          Длительность самой поездки подставляется в tooltip для контекста. */}
      {stopMarkers.map((t) => {
        const endedAt = t.endedAt ?? t.startedAt;
        return (
          <YMapMarker key={`stop-${t.id}`} coordinates={[t.endLon, t.endLat]}>
            <div
              className="flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-50 shadow"
              title={`Был тут в ${hhmm(endedAt)} · поездка ${durationRu(t.startedAt, t.endedAt)}`}
            >
              <span className="text-[10px] font-semibold text-amber-700">П</span>
            </div>
          </YMapMarker>
        );
      })}
      {first && (
        <YMapMarker coordinates={[first.lon, first.lat]}>
          <div
            className="h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-green-600 shadow"
            title={`Начало: ${hhmm(first.recordedAt)}`}
          />
        </YMapMarker>
      )}
      {last && last !== first && (
        <YMapMarker coordinates={[last.lon, last.lat]}>
          <div
            className="h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-red-600 shadow"
            title={`Конец: ${hhmm(last.recordedAt)}`}
          />
        </YMapMarker>
      )}
    </>
  );
}
