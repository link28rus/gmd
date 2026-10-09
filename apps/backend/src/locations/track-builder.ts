import { distanceMeters } from '../common/geo-distance';

// v0.63.0 — сборка маршрута из «хороших» точек (trackFlag IS NULL).
// Чистые функции: поиск стоянок, сворачивание стоянки в одну точку,
// лёгкое сглаживание, длина пути. Используются и для отрисовки трека,
// и для нарезки поездок (TripsService).

export interface TrackInputPoint {
  lat: number;
  lon: number;
  t: number; // мс
  accuracy: number | null;
}

export interface Stay {
  startIdx: number;
  endIdx: number;
  lat: number;
  lon: number;
  from: number; // мс, первая точка стоянки (приезд)
  to: number; // мс, последняя точка стоянки (отъезд)
}

export interface TrackOutPoint {
  lat: number;
  lon: number;
  t: number;
  // Погрешность исходной точки — радиус поиска дороги при привязке (road-match).
  // У вершин стоянок null.
  accuracy?: number | null;
}

export interface BuiltTrack {
  points: TrackOutPoint[];
  stays: Stay[];
}

function dist(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return distanceMeters(a.lat, a.lon, b.lat, b.lon);
}

/**
 * Стоянки (stay-point detection, Li et al. 2008): подряд идущие точки в
 * радиусе radiusM от центра группы, которые длятся не меньше minMs.
 * Центр — среднее точек с весом 1/погрешность², поэтому точная точка
 * значит больше грубой. Одна точка-вылет посреди стоянки (отражение сигнала)
 * стоянку не рвёт — её пропускаем, если следующая снова внутри.
 */
export function detectStays(points: TrackInputPoint[], radiusM: number, minMs: number): Stay[] {
  const stays: Stay[] = [];
  let i = 0;
  while (i < points.length) {
    // Центр — накопительная взвешенная сумма принятых точек: O(1) на точку.
    // Пересчёт по всей группе на каждой точке был O(L²) и на многодневной
    // стоянке (дача, 30 дней для подсказок мест) вешал event loop.
    const acc = { sw: 0, lat: 0, lon: 0 };
    addWeighted(acc, points[i]);
    let c = { lat: points[i].lat, lon: points[i].lon };
    let last = i;
    let j = i + 1;
    while (j < points.length) {
      if (dist(c, points[j]) <= radiusM) {
        last = j;
        addWeighted(acc, points[j]);
        c = { lat: acc.lat / acc.sw, lon: acc.lon / acc.sw };
        j++;
        continue;
      }
      if (j + 1 < points.length && dist(c, points[j + 1]) <= radiusM) {
        j++; // одиночный вылет — пропускаем, в центр не берём
        continue;
      }
      break;
    }
    // Края по итоговому центру: первая точка группы могла быть последней
    // точкой дороги, а не стоянки — тогда приезд сдвинулся бы раньше.
    let first = i;
    while (first < last && dist(c, points[first]) > radiusM) first++;
    while (last > first && dist(c, points[last]) > radiusM) last--;
    if (points[last].t - points[first].t >= minMs) {
      stays.push({
        startIdx: first,
        endIdx: last,
        lat: c.lat,
        lon: c.lon,
        from: points[first].t,
        to: points[last].t,
      });
      i = last + 1;
    } else {
      i++;
    }
  }
  return stays;
}

// Точка в центр группы с весом 1/погрешность². В сумму идут только точки,
// принятые в радиусе от текущего центра, — вылеты центр на себя не тянут.
function addWeighted(acc: { sw: number; lat: number; lon: number }, p: TrackInputPoint): void {
  const a = Math.max(5, p.accuracy ?? 25);
  const w = 1 / (a * a);
  acc.sw += w;
  acc.lat += p.lat * w;
  acc.lon += p.lon * w;
}

// Сглаживание — Калман с обратным проходом (RTS), отдельно на каждом
// непрерывном участке движения. Участок рвётся на стоянке и на паузе дольше
// этого срока: через разрыв «нет данных» сглаживать нечего.
const SMOOTH_MAX_GAP_MS = 120_000;
// Минимальная «скорость блуждания» модели, м/с — как у пешехода. Фактическая
// берётся по расстоянию между соседними точками, поэтому машина не отстаёт.
const SMOOTH_MIN_SPEED_MPS = 3;

/**
 * Трек для отрисовки: стоянки свёрнуты в две вершины в центре (приезд и
 * отъезд — чтобы разрывы «нет данных» на клиенте считались по реальному
 * времени), точки движения сглажены.
 *
 * Почему не скользящее среднее: оно срезает углы. Калман с шумом измерения
 * = погрешность² почти не трогает точные GPS-точки (±5 м) и сильно тянет
 * к линии грубые (±40 м), а обратный проход убирает запаздывание на поворотах.
 */
export function buildTrack(
  points: TrackInputPoint[],
  stopRadiusM: number,
  stopMinMs: number,
): BuiltTrack {
  const stays = detectStays(points, stopRadiusM, stopMinMs);
  const out: TrackOutPoint[] = [];
  let run: TrackInputPoint[] = [];
  const flush = (): void => {
    out.push(...smoothRun(run));
    run = [];
  };
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const stay = stays[s];
    if (stay && i === stay.startIdx) {
      flush();
      out.push({ lat: stay.lat, lon: stay.lon, t: stay.from });
      if (stay.to > stay.from) out.push({ lat: stay.lat, lon: stay.lon, t: stay.to });
      i = stay.endIdx;
      s++;
      continue;
    }
    const prev = run[run.length - 1];
    if (prev && points[i].t - prev.t > SMOOTH_MAX_GAP_MS) flush();
    run.push(points[i]);
  }
  flush();
  return { points: out, stays };
}

// Модель «случайного блуждания» по каждой координате. Коэффициенты зависят
// только от погрешностей и интервалов, поэтому одни и те же применяются к
// широте и долготе — перевод в метры не нужен.
function smoothRun(run: TrackInputPoint[]): TrackOutPoint[] {
  const n = run.length;
  if (n < 3) return run.map((p) => ({ lat: p.lat, lon: p.lon, t: p.t, accuracy: p.accuracy }));
  const r = run.map((p) => {
    const a = Math.max(3, p.accuracy ?? 25);
    return a * a;
  });
  const lat = new Array<number>(n);
  const lon = new Array<number>(n);
  const P = new Array<number>(n); // дисперсия после измерения
  const Ppred = new Array<number>(n); // дисперсия до измерения
  lat[0] = run[0].lat;
  lon[0] = run[0].lon;
  P[0] = r[0];
  Ppred[0] = r[0];
  for (let k = 1; k < n; k++) {
    const dt = Math.max(1, (run[k].t - run[k - 1].t) / 1000);
    const v = Math.max(SMOOTH_MIN_SPEED_MPS, dist(run[k - 1], run[k]) / dt);
    Ppred[k] = P[k - 1] + (v * dt) ** 2;
    const K = Ppred[k] / (Ppred[k] + r[k]);
    lat[k] = lat[k - 1] + K * (run[k].lat - lat[k - 1]);
    lon[k] = lon[k - 1] + K * (run[k].lon - lon[k - 1]);
    P[k] = (1 - K) * Ppred[k];
  }
  // Обратный проход Rauch–Tung–Striebel.
  for (let k = n - 2; k >= 0; k--) {
    const C = P[k] / Ppred[k + 1];
    lat[k] = lat[k] + C * (lat[k + 1] - lat[k]);
    lon[k] = lon[k] + C * (lon[k + 1] - lon[k]);
  }
  return run.map((p, k) => ({ lat: lat[k], lon: lon[k], t: p.t, accuracy: p.accuracy }));
}

/** Длина ломаной в метрах. */
export function pathLength(points: Array<{ lat: number; lon: number }>): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i]);
  return sum;
}

export interface TripSegment {
  startedAt: number;
  endedAt: number;
  isActive: boolean;
  pointsCount: number;
  distanceM: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  // Очищенный трек поездки — по нему считается пробег по дорогам (v0.80.0).
  route: TrackOutPoint[];
}

const TRIP_GAP_SPLIT_MS = 60 * 60_000;

export interface TrackParams {
  idleMs: number;
  idleRadiusM: number;
  stopMinMs: number;
}

/**
 * v0.63.0 — нарезка поездок по стоянкам. Стоянка — пребывание в радиусе
 * idleRadiusM не меньше idleMs. Поездка — всё между двумя стоянками:
 * начинается с последней точки прежней стоянки (момент отъезда), кончается
 * первой точкой следующей (момент приезда). Раньше поездка начиналась с
 * любой точки после закрытия предыдущей и «прилипала» к стоянке до 30 мин
 * с обеих сторон.
 *
 * Разрыв без хороших точек дольше часа (телефон выключен, GPS не ловит)
 * тоже делит поездку, как minimalNoDataDuration в Traccar: иначе выходила
 * «поездка» на 11 часов через ночь.
 */
export function segmentTrips(
  points: TrackInputPoint[],
  p: TrackParams & { now: number },
): TripSegment[] {
  const stays = detectStays(points, p.idleRadiusM, p.idleMs);
  type Range = { from: number; to: number; prev?: Stay; next?: Stay };
  const between: Range[] = [];
  let prev: Stay | undefined;
  for (const st of stays) {
    if (prev || st.startIdx > 0) {
      between.push({ from: prev ? prev.endIdx : 0, to: st.startIdx, prev, next: st });
    }
    prev = st;
  }
  const tailFrom = prev ? prev.endIdx : 0;
  if (points.length > 0 && tailFrom < points.length - 1) {
    between.push({ from: tailFrom, to: points.length - 1, prev, next: undefined });
  }
  const ranges: Range[] = [];
  for (const r of between) {
    let from = r.from;
    for (let k = r.from + 1; k <= r.to; k++) {
      if (points[k].t - points[k - 1].t <= TRIP_GAP_SPLIT_MS) continue;
      ranges.push({ from, to: k - 1, prev: from === r.from ? r.prev : undefined });
      from = k;
    }
    ranges.push({ from, to: r.to, prev: from === r.from ? r.prev : undefined, next: r.next });
  }

  const out: TripSegment[] = [];
  ranges.forEach((r, idx) => {
    const slice = points.slice(r.from, r.to + 1);
    if (slice.length < 2) return;
    const first = slice[0];
    const last = slice[slice.length - 1];
    const start = r.prev ? { lat: r.prev.lat, lon: r.prev.lon } : first;
    const end = r.next ? { lat: r.next.lat, lon: r.next.lon } : last;
    // Концы — центры стоянок, а не случайная точка из «облака» стоянки.
    const route: TrackInputPoint[] = slice.map((q, k) =>
      k === 0 && r.prev
        ? { ...q, lat: start.lat, lon: start.lon }
        : k === slice.length - 1 && r.next
          ? { ...q, lat: end.lat, lon: end.lon }
          : q,
    );
    const built = buildTrack(route, p.idleRadiusM, p.stopMinMs);
    let maxDisplacement = 0;
    for (const q of slice) {
      maxDisplacement = Math.max(maxDisplacement, dist(start, q));
    }
    const isLast = idx === ranges.length - 1;
    const isActive = isLast && !r.next && p.now - last.t < p.idleMs;
    // GPS-шум вокруг одного места — не поездка. Активную тоже отсекаем:
    // пока ребёнок не отошёл дальше радиуса, рисовать нечего.
    if (maxDisplacement < p.idleRadiusM) return;
    out.push({
      startedAt: first.t,
      endedAt: last.t,
      isActive,
      pointsCount: slice.length,
      distanceM: Math.round(pathLength(built.points)),
      startLat: start.lat,
      startLon: start.lon,
      endLat: end.lat,
      endLon: end.lon,
      route: built.points,
    });
  });
  return out;
}
