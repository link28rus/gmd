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
}

export interface TrackGap<T extends TrackPoint> {
  /** Последняя точка перед разрывом. */
  from: T;
  /** Первая точка после разрыва. */
  to: T;
  /** to.recordedAt − from.recordedAt. */
  durationMs: number;
}

export interface TrackSplit<T extends TrackPoint> {
  /**
   * Непрерывные куски трека в исходном порядке. Сегмент из одной точки —
   * одиночная точка между двумя разрывами (или на краю трека): линию из неё
   * не рисуем, но точку не теряем.
   */
  segments: T[][];
  /** Разрывы между сегментами: gaps[i] соединяет segments[i] и segments[i + 1]. */
  gaps: TrackGap<T>[];
}

const EARTH_RADIUS_M = 6_371_000;

/** Расстояние между двумя точками по поверхности Земли (haversine), метры. */
export function haversineMeters(a: TrackPoint, b: TrackPoint): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const q =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

/**
 * Режет трек на сегменты. Между соседними точками A→B разрыв, если
 * ОДНОВРЕМЕННО B.recordedAt − A.recordedAt > TRACK_GAP_MIN_MS и
 * расстояние A–B > TRACK_GAP_MIN_DIST_M.
 *
 * @param points точки, отсортированные по recordedAt по возрастанию.
 */
export function splitTrackByGaps<T extends TrackPoint>(points: readonly T[]): TrackSplit<T> {
  if (points.length === 0) return { segments: [], gaps: [] };

  const segments: T[][] = [];
  const gaps: TrackGap<T>[] = [];
  let current: T[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const durationMs = Date.parse(b.recordedAt) - Date.parse(a.recordedAt);
    // NaN (битая дата) в обоих сравнениях даёт false — такую пару не режем.
    if (durationMs > TRACK_GAP_MIN_MS && haversineMeters(a, b) > TRACK_GAP_MIN_DIST_M) {
      segments.push(current);
      gaps.push({ from: a, to: b, durationMs });
      current = [b];
    } else {
      current.push(b);
    }
  }
  segments.push(current);

  return { segments, gaps };
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
