import { distanceMeters } from '../common/geo-distance';

// v0.63.0 — разметка точек для построения маршрута. Чистые функции без БД:
// один и тот же код работает при приёме точек и при переразметке истории.
//
// Пометки (колонка locations.trackFlag):
//   null      — точка годится для трека и поездок;
//   'coarse'  — погрешность хуже track.accuracy_max_m (Wi-Fi/вышки, ±100 м);
//   'outlier' — телепорт: до точки нельзя добраться за прошедшее время,
//               или «игла» — прыжок в сторону и возврат обратно;
//   'mock'    — подделка GPS (Location.isMock), ставится при приёме и не
//               пересматривается.

export type TrackFlag = 'coarse' | 'outlier' | 'mock';

export interface QualityPoint {
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  t: number; // recordedAt, мс
  flag: TrackFlag | null; // сохранённая пометка
}

export interface QualityOptions {
  accuracyMaxM: number;
  maxSpeedMps: number;
}

// Погрешность, если телефон её не прислал (старые клиенты).
const DEFAULT_ACCURACY_M = 25;
// Доплеровская скорость (Location.getSpeed) — мгновенная и точная, но за
// интервал ребёнок мог разогнаться: берём запас ×1.5 и +5 м/с. Доверяем ей
// только на коротком интервале — за минуты скорость меняется как угодно.
const SPEED_SLACK = 1.5;
const SPEED_EXTRA_MPS = 5;
const SPEED_TRUST_MAX_MS = 60_000;
// «Игла»: отскок дальше 100 м и возврат к исходной точке в пределах 3 минут.
const NEEDLE_MIN_M = 100;
const NEEDLE_MAX_SPAN_MS = 3 * 60_000;
const NEEDLE_RETURN_RATIO = 0.3;
// …и прыжок во много раз больше предыдущего шага. Иначе это разворот на
// дороге: при равномерной записи шаги до и после разворота одинаковые.
const NEEDLE_STEP_RATIO = 4;

function acc(p: QualityPoint): number {
  return p.accuracy ?? DEFAULT_ACCURACY_M;
}

function dist(a: QualityPoint, b: QualityPoint): number {
  return distanceMeters(a.lat, a.lon, b.lat, b.lon);
}

/** Сколько метров правдоподобно пройти от a до b (с учётом погрешностей обеих). */
export function reachableMeters(a: QualityPoint, b: QualityPoint, opts: QualityOptions): number {
  const dtMs = Math.max(0, b.t - a.t);
  let v = opts.maxSpeedMps;
  if (a.speed != null && b.speed != null && dtMs <= SPEED_TRUST_MAX_MS) {
    v = Math.min(v, Math.max(a.speed, b.speed) * SPEED_SLACK + SPEED_EXTRA_MPS);
  }
  return (v * dtMs) / 1000 + acc(a) + acc(b);
}

function reachable(a: QualityPoint, b: QualityPoint, opts: QualityOptions): boolean {
  return dist(a, b) <= reachableMeters(a, b, opts);
}

/**
 * Размечает последовательность точек одного устройства (по возрастанию t).
 * Возвращает новую пометку для каждой точки.
 *
 * trustStoredPrefix — точки до первой сохранённой «хорошей» сохраняют свои
 * пометки. Нужно при приёме: контекст из БД начинается с произвольной точки,
 * и если это старый телепорт, он не должен стать якорем для остальных.
 */
export function classifyTrack(
  points: QualityPoint[],
  opts: QualityOptions,
  { trustStoredPrefix = false }: { trustStoredPrefix?: boolean } = {},
): Array<TrackFlag | null> {
  const flags: Array<TrackFlag | null> = points.map((p) => (p.flag === 'mock' ? 'mock' : null));
  let start = 0;
  if (trustStoredPrefix) {
    while (start < points.length && points[start].flag !== null) {
      flags[start] = points[start].flag;
      start++;
    }
  }

  // 1. Грубые точки.
  for (let i = start; i < points.length; i++) {
    const a = points[i].accuracy;
    if (flags[i] === null && a !== null && a > opts.accuracyMaxM) flags[i] = 'coarse';
  }

  // 2. Телепорты: сравнение с последней хорошей точкой. Защита от залипания:
  // если две отвергнутые точки подряд согласны между собой — ошибался якорь
  // (или ребёнок правда переместился без точек), принимаем обе.
  let lastGood = -1;
  let lastRejected = -1;
  for (let i = start; i < points.length; i++) {
    if (flags[i] !== null) continue;
    if (lastGood < 0 || reachable(points[lastGood], points[i], opts)) {
      lastGood = i;
      lastRejected = -1;
      continue;
    }
    if (lastRejected >= 0 && reachable(points[lastRejected], points[i], opts)) {
      flags[lastRejected] = null;
      lastGood = i;
      lastRejected = -1;
      continue;
    }
    flags[i] = 'outlier';
    lastRejected = i;
  }

  // 3. Иглы среди оставшихся: A → B далеко → C снова рядом с A, быстро.
  // Скорость такое пропускает (ребёнок в машине), форма — нет.
  let before = -1;
  let prev = -1;
  let cur = -1;
  for (let i = start; i < points.length; i++) {
    if (flags[i] !== null) continue;
    if (prev >= 0 && cur >= 0) {
      const stepBefore = before >= 0 ? dist(points[before], points[prev]) : 0;
      if (isNeedle(points[prev], points[cur], points[i], stepBefore)) {
        flags[cur] = 'outlier';
        cur = i; // prev остаётся: игла выкинута, A соединяется с C
        continue;
      }
    }
    before = prev;
    prev = cur;
    cur = i;
  }

  return flags;
}

function isNeedle(a: QualityPoint, b: QualityPoint, c: QualityPoint, stepBefore: number): boolean {
  if (c.t - a.t > NEEDLE_MAX_SPAN_MS) return false;
  const ab = dist(a, b);
  const bc = dist(b, c);
  if (ab < NEEDLE_MIN_M || bc < NEEDLE_MIN_M) return false;
  if (ab < NEEDLE_STEP_RATIO * stepBefore) return false;
  // Отскок должен заметно превышать погрешность, иначе это просто дрожь.
  if (ab < 2 * (acc(a) + acc(b))) return false;
  return dist(a, c) < NEEDLE_RETURN_RATIO * Math.min(ab, bc);
}
