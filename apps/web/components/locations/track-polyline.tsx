'use client';
import { Fragment, useMemo, type ReactElement } from 'react';
import { Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import type { LocationDto, StayDto, TripDto } from '@/lib/api/locations';
import {
  formatGapLabel,
  pathMidpoint,
  splitTrackByGaps,
  type TrackGap,
} from '@/lib/geo/track-gaps';

interface Props {
  items: LocationDto[];
  /**
   * Завершённые "поездки" ребёнка. Если передано — между поездками рисуем
   * крупный маркер-кружок "Стоял 13:05 – 15:20 (2ч 15мин)" вместо пучка
   * точек. Без stops ведём себя как раньше (всё рисуем как polyline+точки).
   */
  stops?: TripDto[];
  /**
   * v0.63.0: стоянки, найденные сервером (ребёнок пробыл на месте несколько
   * минут). Если переданы — маркеры «П» ставятся по ним, а не по концам
   * поездок: точнее по месту и видно, сколько он там был.
   */
  stays?: StayDto[];
}

interface StopView {
  key: string;
  lat: number;
  lon: number;
  title: string;
}

// v0.31.0 — клиентская фильтрация GPS-шума. Работает поверх бэкендного
// accuracy floor (100м) и мобильного gate (75м); для ухоженных треков
// — второй слой защиты на уже накопленных старыми версиями данных.
const UI_ACCURACY_GATE_M = 50;

// Чтобы не перегружать карту при больших треках, показываем кружочки
// каждую N-ю точку. Первая и последняя — всегда.
const MAX_DOTS = 120;

// Непрерывный участок трека — сплошная линия.
const TRACK_PATH: L.PathOptions = { color: '#2563eb', weight: 3 };

// Участок без данных (см. lib/geo/track-gaps.ts) — тонкий серый пунктир,
// чтобы не выдавать прямую между двумя точками за реальный маршрут.
// Цвет фиксированный: Leaflet пишет его в SVG-атрибут stroke, а там
// var(--…) не работает. slate-500 = --muted-foreground светлой темы,
// читается и на обычных, и на затемнённых (dim/dark) тайлах.
const GAP_PATH: L.PathOptions = {
  color: '#64748b',
  weight: 2,
  dashArray: '4 6',
  interactive: false,
};

// v0.80.0: участок, достроенный сервером по дороге в разрыве без данных, —
// пунктир цветом трека: «скорее всего ехал так», но это не записанные точки.
const INFERRED_PATH: L.PathOptions = {
  color: TRACK_PATH.color,
  weight: 3,
  dashArray: '6 8',
  interactive: false,
};

/**
 * v0.80.0: подпись «нет данных N мин» ставим, только если пропуск не меньше
 * минуты — «нет данных 0 мин» на коротком достроенном куске ничего не говорит.
 */
const INFERRED_LABEL_MIN_MS = 60_000;

// Подпись разрыва кладём под все остальные маркеры (старт/финиш, точки,
// стоянки, аватар ребёнка): Leaflet считает z-index как y + zIndexOffset.
const GAP_LABEL_Z_OFFSET = -1000;

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

/**
 * Одиночная точка между двумя разрывами линии не имеет — видна только как
 * кружок. Гарантируем, что прореживание sampleForDots её не выбросило.
 */
function withLonePoints(dots: LocationDto[], segments: LocationDto[][]): LocationDto[] {
  const lone = segments.filter((s) => s.length === 1).map((s) => s[0]);
  if (lone.length === 0) return dots;
  const present = new Set(dots);
  const missing = lone.filter((p) => !present.has(p));
  return missing.length === 0 ? dots : [...dots, ...missing];
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

// Компактная плашка «нет данных N мин» по центру разрыва. Видна всегда,
// без наведения — кабинет открывают и с телефона. Цвета из токенов темы
// (в globals.css они HSL-тройками, поэтому hsl(var(--…))).
export const gapLabelIcon = (label: string): L.DivIcon =>
  L.divIcon({
    html: `<div style="transform:translate(-50%,-50%);position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;border-radius:9999px;border:1px solid hsl(var(--border, 214.3 31.8% 91.4%));background:hsl(var(--card, 0 0% 100%) / 0.92);padding:0 6px;font-size:11px;line-height:16px;font-weight:500;color:hsl(var(--muted-foreground, 215.4 16.3% 46.9%));box-shadow:0 1px 2px rgba(0,0,0,0.15);">${escapeHtml(label)}</div>`,
    className: 'gmd-gap-label',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });

/**
 * Середина отрезка в той же проекции, в которой Leaflet его рисует
 * (Web Mercator), — подпись ложится ровно на пунктир и на длинных разрывах.
 */
function gapMidpoint(gap: TrackGap<LocationDto>): [number, number] {
  const proj = L.Projection.SphericalMercator;
  const a = proj.project(L.latLng(gap.from.lat, gap.from.lon));
  const b = proj.project(L.latLng(gap.to.lat, gap.to.lon));
  const mid = proj.unproject(a.add(b).divideBy(2));
  return [mid.lat, mid.lng];
}

export function TrackPolyline({ items, stops, stays }: Props): ReactElement | null {
  // Шаг 1: accuracy-фильтр. v0.80.0: в режиме «по дорогам» сервер отдаёт
  // точки с accuracy=null (трек уже очищен) — они проходят.
  const filtered = useMemo(
    () => items.filter((p) => p.accuracy == null || p.accuracy <= UI_ACCURACY_GATE_M),
    [items],
  );

  // Шаг 2: режем трек по «дырам» в данных (телефон выключен/сел/без GPS).
  // Непрерывные сегменты рисуем сплошной линией, разрывы — отдельно, иначе
  // карта соединяет соседние точки прямой «через поле».
  // Упрощения Douglas-Peucker здесь нет намеренно (epsilon 10м «спрямлял»
  // маршрут мимо реальных маркеров точек) — линия идёт через все
  // отображаемые точки. Если вернуть упрощение — применять к каждому
  // сегменту отдельно, разрывы не упрощать.
  // v0.80.0: участки, достроенные сервером по дороге (inferred), — отдельно:
  // пунктир цветом трека с той же подписью, что у разрыва.
  const { segments, gaps, inferred } = useMemo(() => splitTrackByGaps(filtered), [filtered]);

  // Мемоизируем позиции и иконки: react-leaflet на каждый новый объект в
  // props зовёт setLatLngs/setIcon, а карта ре-рендерится на каждом опросе.
  const segmentLines = useMemo(
    () =>
      segments
        .filter((s) => s.length >= 2)
        .map((s) => s.map((p): [number, number] => [p.lat, p.lon])),
    [segments],
  );
  const gapViews = useMemo(
    () =>
      gaps.map((g) => ({
        line: [
          [g.from.lat, g.from.lon],
          [g.to.lat, g.to.lon],
        ] as Array<[number, number]>,
        mid: gapMidpoint(g),
        icon: gapLabelIcon(formatGapLabel(g.durationMs)),
      })),
    [gaps],
  );

  const inferredViews = useMemo(
    () =>
      inferred.map((r) => {
        const mid = pathMidpoint(r.points);
        return {
          line: r.points.map((p): [number, number] => [p.lat, p.lon]),
          label:
            mid && r.durationMs >= INFERRED_LABEL_MIN_MS
              ? {
                  mid: [mid.lat, mid.lon] as [number, number],
                  icon: gapLabelIcon(formatGapLabel(r.durationMs)),
                }
              : null,
        };
      }),
    [inferred],
  );

  const stopMarkers = useMemo((): StopView[] => {
    if (stays && stays.length > 0) {
      return stays.map((s) => ({
        key: `stay-${s.from}`,
        lat: s.lat,
        lon: s.lon,
        title: `Стоял ${hhmm(s.from)}–${hhmm(s.to)} · ${durationRu(s.from, s.to)}`,
      }));
    }
    return (stops ?? [])
      .filter((t) => !t.isActive)
      .map((t) => ({
        key: `stop-${t.id}`,
        lat: t.endLat,
        lon: t.endLon,
        title: `Был тут в ${hhmm(t.endedAt ?? t.startedAt)} · поездка ${durationRu(t.startedAt, t.endedAt)}`,
      }));
  }, [stops, stays]);

  if (filtered.length < 2 && stopMarkers.length === 0) return null;

  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  // Достроенные точки кружками не рисуем: время у них условное.
  const realPoints = inferred.length > 0 ? filtered.filter((p) => !p.inferred) : filtered;
  const dots = withLonePoints(sampleForDots(realPoints), segments);

  return (
    <>
      {gapViews.map((g, i) => (
        <Fragment key={`gap-${i}`}>
          <Polyline positions={g.line} pathOptions={GAP_PATH} />
          <Marker
            position={g.mid}
            icon={g.icon}
            interactive={false}
            keyboard={false}
            zIndexOffset={GAP_LABEL_Z_OFFSET}
          />
        </Fragment>
      ))}
      {inferredViews.map((r, i) => (
        <Fragment key={`inf-${i}`}>
          <Polyline positions={r.line} pathOptions={INFERRED_PATH} />
          {r.label && (
            <Marker
              position={r.label.mid}
              icon={r.label.icon}
              interactive={false}
              keyboard={false}
              zIndexOffset={GAP_LABEL_Z_OFFSET}
            />
          )}
        </Fragment>
      ))}
      {segmentLines.map((line, i) => (
        <Polyline key={`seg-${i}`} positions={line} pathOptions={TRACK_PATH} />
      ))}
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
      {stopMarkers.map((s) => (
        <Marker
          key={s.key}
          position={[s.lat, s.lon]}
          icon={stopIcon('П', s.title)}
          title={s.title}
        />
      ))}
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
