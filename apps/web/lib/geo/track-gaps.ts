// apps/web/lib/geo/track-gaps.ts
// Разбиение трека ребёнка на непрерывные сегменты по «дырам» в данных.
//
// Если телефон долго молчал (выключен, сел, GPS отключён), соседние точки
// нельзя соединять обычной линией трека — карта покажет прямую «через поле»,
// будто ребёнок так ехал. Такой участок рисуется отдельно (пунктир + подпись
// «нет данных N мин»), а сегменты между разрывами — сплошной линией.
//
// Контракт одинаковый с приложением родителя: менять константы только
// синхронно в обоих клиентах.
//
// v0.80.0: backend привязывает трек к дорогам (OSRM) и в разрывах без данных
// может достроить путь по дороге — такие точки приходят с `inferred: true`.
// Отрезок i-1 → i достроен, если хотя бы одна из двух точек inferred. Серия
// таких отрезков — отдельный вид участка: рисуется пунктиром цветом трека
// («скорее всего ехал так»), а не серым, как обычный разрыв.

/**
 * Разрыв по времени: в движении телефон шлёт точку раз в 5–90 с, поэтому
 * 5 минут тишины между соседними точками — это пропуск данных, а не пауза.
 */
export const TRACK_GAP_MIN_MS = 5 * 60_000;

/**
 * Разрыв по расстоянию: прыжок меньше 300 м визуально не врёт (ребёнок
 * стоял/медленно шёл рядом), рисовать его как дыру смысла нет.
 */
export const TRACK_GAP_MIN_DIST_M = 300;

export interface TrackPoint {
  lat: number;
  lon: number;
  /** ISO-8601. */
  recordedAt: string;
  /**
   * v0.80.0: точка достроена сервером по дороге в разрыве без данных; её
   * время интерполировано. Нет поля (старый backend, режим «как записано») —
   * обычная точка.
   */
  inferred?: boolean;
}

export interface TrackGap<T extends TrackPoint> {
  /** Последняя точка перед разрывом. */
  from: T;
  /** Первая точка после разрыва. */
  to: T;
  /** to.recordedAt − from.recordedAt. */
  durationMs: number;
}

/**
 * v0.80.0: участок, достроенный сервером по дороге. points — линия целиком:
 * последняя реальная точка перед серией, достроенные точки, первая реальная
 * после серии (на краю трека реальной точки с той стороны может не быть).
 */
export interface TrackInferredRun<T extends TrackPoint> {
  points: T[];
  /** Первая точка участка — обычно последняя реальная перед ним. */
  from: T;
  /** Последняя точка участка — обычно первая реальная после него. */
  to: T;
  /** to.recordedAt − from.recordedAt — сколько не было данных. */
  durationMs: number;
}

export interface TrackSplit<T extends TrackPoint> {
  /**
   * Непрерывные куски трека из реальных точек в исходном порядке. Сегмент из
   * одной точки — одиночная точка между двумя разрывами/достроенными участками
   * (или на краю трека): линию из неё не рисуем, но точку не теряем.
   */
  segments: T[][];
  /** Разрывы без достройки (пунктир «нет данных»), по времени. */
  gaps: TrackGap<T>[];
  /** v0.80.0: достроенные по дороге участки, по времени. */
  inferred: TrackInferredRun<T>[];
}

const EARTH_RADIUS_M = 6_371_000;

/** Расстояние между двумя точками по поверхности Земли (haversine), метры. */
export function haversineMeters(
  a: Pick<TrackPoint, 'lat' | 'lon'>,
  b: Pick<TrackPoint, 'lat' | 'lon'>,
): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

/**
 * Режет трек на сегменты. Между соседними реальными точками A→B разрыв, если
 * ОДНОВРЕМЕННО B.recordedAt − A.recordedAt > TRACK_GAP_MIN_MS и
 * расстояние A–B > TRACK_GAP_MIN_DIST_M.
 *
 * v0.80.0: отрезки с достроенной точкой (inferred) в сегменты не входят —
 * непрерывная их серия становится отдельным участком в `inferred`. Детекцию
 * разрывов на них не делаем: времена достроенных точек интерполированы.
 * Серия заканчивается на первой реальной точке; если сразу за ней снова
 * достройка — начинается новая серия, а реальная точка между ними остаётся
 * одиночным сегментом.
 *
 * @param points точки, отсортированные по recordedAt по возрастанию.
 */
export function splitTrackByGaps<T extends TrackPoint>(points: readonly T[]): TrackSplit<T> {
  const segments: T[][] = [];
  const gaps: TrackGap<T>[] = [];
  const inferred: TrackInferredRun<T>[] = [];
  let current: T[] = [];
  let run: T[] | null = null;

  const closeRun = (r: T[]): void => {
    // Одна достроенная точка без соседей линии не даёт — рисовать нечего.
    if (r.length < 2) return;
    const from = r[0];
    const to = r[r.length - 1];
    inferred.push({
      points: r,
      from,
      to,
      durationMs: Date.parse(to.recordedAt) - Date.parse(from.recordedAt),
    });
  };

  for (const p of points) {
    if (run) {
      run.push(p);
      if (p.inferred !== true) {
        // Первая реальная точка после достройки — конец участка и начало
        // нового сегмента.
        closeRun(run);
        run = null;
        current = [p];
      }
      continue;
    }

    if (p.inferred === true) {
      // Достройка начинается от последней реальной точки (если она есть).
      const prev = current.length > 0 ? current[current.length - 1] : null;
      if (current.length > 0) segments.push(current);
      current = [];
      run = prev ? [prev, p] : [p];
      continue;
    }

    if (current.length === 0) {
      current = [p];
      continue;
    }
    const a = current[current.length - 1];
    const durationMs = Date.parse(p.recordedAt) - Date.parse(a.recordedAt);
    // NaN (битая дата) в обоих сравнениях даёт false — такую пару не режем.
    if (durationMs > TRACK_GAP_MIN_MS && haversineMeters(a, p) > TRACK_GAP_MIN_DIST_M) {
      segments.push(current);
      gaps.push({ from: a, to: p, durationMs });
      current = [p];
    } else {
      current.push(p);
    }
  }
  // Трек закончился достроенной точкой — участок без реального конца.
  if (run) closeRun(run);
  if (current.length > 0) segments.push(current);

  return { segments, gaps, inferred };
}

/**
 * v0.80.0: середина ломаной по длине (haversine) — для подписи достроенного
 * участка: он идёт по дорогам, и середина прямой «от–до» может оказаться
 * далеко от линии. Внутри отрезка — линейная интерполяция координат.
 */
export function pathMidpoint(
  points: readonly Pick<TrackPoint, 'lat' | 'lon'>[],
): { lat: number; lon: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon };
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineMeters(points[i - 1], points[i]);
    lens.push(d);
    total += d;
  }
  if (total === 0) return { lat: points[0].lat, lon: points[0].lon };
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const d = lens[i - 1];
    if (left <= d && d > 0) {
      const k = left / d;
      const a = points[i - 1];
      const b = points[i];
      return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k };
    }
    left -= d;
  }
  const last = points[points.length - 1];
  return { lat: last.lat, lon: last.lon };
}

/**
 * Подпись разрыва: «нет данных 67 мин» → «нет данных 1 ч 7 мин»,
 * ровные часы — «нет данных 2 ч». Минуты округляются вниз — так же, как в
 * приложении родителя (Duration.inMinutes).
 */
export function formatGapLabel(durationMs: number): string {
  const totalMin = Math.max(0, Math.floor(durationMs / 60_000));
  if (totalMin < 60) return `нет данных ${totalMin} мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `нет данных ${h} ч` : `нет данных ${h} ч ${m} мин`;
}
