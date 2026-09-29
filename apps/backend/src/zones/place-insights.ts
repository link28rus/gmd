import { distanceMeters } from '../common/geo-distance';
import { detectStays } from '../locations/track-builder';
import type { TrackInputPoint } from '../locations/track-builder';

// v0.67.0 (геозоны v2, этап 4): подсказки мест и статистика визитов.
// Чистые функции — без БД и без «сейчас»: стоянки ребёнка за период
// склеиваются в места, по местному времени места узнаются «Дом» (ночи),
// «Школа» (будни днём) и «Частое место» (разные дни).

export type PlaceKind = 'home' | 'school' | 'frequent';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

export const PLACE_PARAMS = {
  // Стоянка: точки в 100 м дольше 20 минут. Погрешность дома ±50 м —
  // меньший радиус рвал бы ночь на куски.
  stayRadiusM: 100,
  stayMinMs: 20 * MIN_MS,
  // Стоянки разных дней ближе этого — одно место.
  clusterRadiusM: 150,
  // Место подсказываем, если оно встречается не меньше чем в стольких днях.
  minDays: 3,
  // Ночь 22:00–07:00: ночёвка засчитывается от трёх часов.
  night: { startMin: 22 * 60, endMin: 7 * 60, minMs: 3 * 60 * MIN_MS },
  // Будни 08:00–15:00: школьный день засчитывается от двух часов.
  school: { startMin: 8 * 60, endMin: 15 * 60, minMs: 2 * 60 * MIN_MS },
  // «Частое место» — день засчитывается от стоянки в 20 минут.
  frequentDayMinMs: 20 * MIN_MS,
  maxFrequent: 3,
  // Радиус подсказанной зоны: разброс стоянок + запас, в пределах 150..300 м.
  minRadiusM: 150,
  maxRadiusM: 300,
} as const;

// ─── Местное время ──────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Смещение пояса в момент `at`, мс: местное время = UTC + смещение. */
export function tzOffsetMs(at: number, tz: string): number {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(at))) {
    if (part.type !== 'literal') p[part.type] = Number.parseInt(part.value, 10);
  }
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return local - Math.floor(at / 1000) * 1000;
}

function dayKey(localDayStart: number): string {
  return new Date(localDayStart).toISOString().slice(0, 10);
}

export interface DailyOverlap {
  /** Местная дата начала окна YYYY-MM-DD (у ночи — дата вечера). */
  day: string;
  /** 0 = ВС … 6 = СБ, день начала окна. */
  weekday: number;
  ms: number;
}

/**
 * Пересечение интервала [a, b] (местные мс — «UTC-часы» местного времени)
 * с ежедневным окном [startMin, endMin). Окно через полночь (endMin ≤
 * startMin) относится к дню, в который началось.
 */
export function dailyOverlap(
  a: number,
  b: number,
  startMin: number,
  endMin: number,
): DailyOverlap[] {
  const out: DailyOverlap[] = [];
  const first = Math.floor(a / DAY_MS) - 1;
  const last = Math.floor(b / DAY_MS);
  for (let d = first; d <= last; d++) {
    const base = d * DAY_MS;
    const ws = base + startMin * MIN_MS;
    const we = endMin > startMin ? base + endMin * MIN_MS : base + DAY_MS + endMin * MIN_MS;
    const ms = Math.min(b, we) - Math.max(a, ws);
    if (ms > 0) out.push({ day: dayKey(base), weekday: new Date(base).getUTCDay(), ms });
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function minuteOfDay(localMs: number): number {
  return Math.floor((((localMs % DAY_MS) + DAY_MS) % DAY_MS) / MIN_MS);
}

// ─── Места ──────────────────────────────────────────────────────────────────

interface LocalStay {
  lat: number;
  lon: number;
  from: number; // местные мс
  to: number;
}

export interface PlaceCluster {
  lat: number;
  lon: number;
  stays: LocalStay[];
  totalMs: number;
}

/**
 * Склейка стоянок в места: от длинных к коротким, стоянка идёт в ближайшее
 * место в радиусе, центр места — среднее стоянок с весом по длительности.
 */
export function clusterStays(stays: LocalStay[], radiusM: number): PlaceCluster[] {
  const order = [...stays].sort((x, y) => y.to - y.from - (x.to - x.from));
  const clusters: PlaceCluster[] = [];
  for (const s of order) {
    const w = Math.max(MIN_MS, s.to - s.from);
    let best: PlaceCluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = distanceMeters(c.lat, c.lon, s.lat, s.lon);
      if (d <= radiusM && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (!best) {
      clusters.push({ lat: s.lat, lon: s.lon, stays: [s], totalMs: w });
      continue;
    }
    const total = best.totalMs + w;
    best.lat = (best.lat * best.totalMs + s.lat * w) / total;
    best.lon = (best.lon * best.totalMs + s.lon * w) / total;
    best.totalMs = total;
    best.stays.push(s);
  }
  return clusters;
}

interface ClusterMetrics {
  cluster: PlaceCluster;
  nightMs: number;
  nightDays: number;
  schoolMs: number;
  schoolDays: number;
  presenceDays: number;
  /** Медиана местного прихода/ухода по дням присутствия — минуты дня. */
  typicalFromMin: number | null;
  typicalToMin: number | null;
  /** То же, только по школьным дням (будни с засчитанным окном). */
  schoolFromMin: number | null;
  schoolToMin: number | null;
}

function sumByDay(items: DailyOverlap[], filter?: (o: DailyOverlap) => boolean) {
  const byDay = new Map<string, number>();
  for (const o of items) {
    if (filter && !filter(o)) continue;
    byDay.set(o.day, (byDay.get(o.day) ?? 0) + o.ms);
  }
  return byDay;
}

function metrics(c: PlaceCluster): ClusterMetrics {
  const P = PLACE_PARAMS;
  const night: DailyOverlap[] = [];
  const school: DailyOverlap[] = [];
  const whole: DailyOverlap[] = [];
  // Приход/уход по местным дням: самый ранний приход и самый поздний уход
  // стоянок, задевших день (обрезаны границами дня).
  const firstIn = new Map<string, number>();
  const lastOut = new Map<string, number>();
  for (const s of c.stays) {
    night.push(...dailyOverlap(s.from, s.to, P.night.startMin, P.night.endMin));
    school.push(...dailyOverlap(s.from, s.to, P.school.startMin, P.school.endMin));
    for (const o of dailyOverlap(s.from, s.to, 0, 24 * 60)) {
      whole.push(o);
      const dayStart = Date.parse(`${o.day}T00:00:00Z`);
      const from = Math.max(s.from, dayStart);
      const to = Math.min(s.to, dayStart + DAY_MS - MIN_MS);
      firstIn.set(o.day, Math.min(firstIn.get(o.day) ?? Infinity, from));
      lastOut.set(o.day, Math.max(lastOut.get(o.day) ?? -Infinity, to));
    }
  }
  const nights = sumByDay(night);
  const schoolByDay = sumByDay(school, (o) => o.weekday >= 1 && o.weekday <= 5);
  const presence = sumByDay(whole);

  const nightDays = [...nights.values()].filter((ms) => ms >= P.night.minMs).length;
  const schoolDayKeys = [...schoolByDay].filter(([, ms]) => ms >= P.school.minMs).map(([d]) => d);
  const presenceKeys = [...presence].filter(([, ms]) => ms >= P.frequentDayMinMs).map(([d]) => d);
  const times = (keys: string[], m: Map<string, number>) =>
    median(keys.filter((k) => m.has(k)).map((k) => minuteOfDay(m.get(k)!)));

  return {
    cluster: c,
    nightMs: [...nights.values()].reduce((a, b) => a + b, 0),
    nightDays,
    schoolMs: [...schoolByDay.values()].reduce((a, b) => a + b, 0),
    schoolDays: schoolDayKeys.length,
    presenceDays: presenceKeys.length,
    typicalFromMin: times(presenceKeys, firstIn),
    typicalToMin: times(presenceKeys, lastOut),
    schoolFromMin: times(schoolDayKeys, firstIn),
    schoolToMin: times(schoolDayKeys, lastOut),
  };
}

function suggestedRadius(c: PlaceCluster): number {
  const P = PLACE_PARAMS;
  const d = c.stays.map((s) => distanceMeters(c.lat, c.lon, s.lat, s.lon)).sort((x, y) => x - y);
  const p90 = d[Math.min(d.length - 1, Math.floor(d.length * 0.9))] ?? 0;
  const r = Math.ceil((p90 + 70) / 10) * 10;
  return Math.min(P.maxRadiusM, Math.max(P.minRadiusM, r));
}

export interface ChildPlace {
  kind: PlaceKind;
  lat: number;
  lon: number;
  radius: number;
  /** Засчитанных дней: ночей для дома, будней для школы, дней для частого места. */
  days: number;
  /**
   * Местных дней от первой до последней точки — знаменатель «N из M». Не «дни
   * с точками»: ночью телефон молчит часами, стоянка перекрывает дни без
   * точек, и ночей выходило больше, чем дней («8 из 6» на проде).
   */
  daysWithData: number;
  /** Обычное время прихода и ухода, минуты дня; у дома не считается. */
  typicalFromMin: number | null;
  typicalToMin: number | null;
}

/**
 * Места одного ребёнка по его хорошим точкам (по возрастанию времени).
 * Дом — место с наибольшим ночным временем среди мест с 3+ ночёвками;
 * школа — другое место с наибольшим временем в будни 08–15 среди мест с 3+
 * такими днями; частые места — остальные, где ребёнок бывал 3+ разных дня.
 */
export function childPlaces(points: TrackInputPoint[], tz: string): ChildPlace[] {
  const P = PLACE_PARAMS;
  if (points.length === 0) return [];
  // Смещение пояса меняется не чаще раза в час — считаем его по часам, а не
  // по каждой точке (Intl на 100 тысячах точек заметно медленный).
  const offsetByHour = new Map<number, number>();
  const offsetAt = (t: number): number => {
    const h = Math.floor(t / 3_600_000);
    let off = offsetByHour.get(h);
    if (off === undefined) {
      off = tzOffsetMs(h * 3_600_000, tz);
      offsetByHour.set(h, off);
    }
    return off;
  };
  const dayIndex = (t: number): number => Math.floor((t + offsetAt(t)) / DAY_MS);
  const daysWithData = dayIndex(points[points.length - 1].t) - dayIndex(points[0].t) + 1;
  const capDays = (n: number): number => Math.min(n, daysWithData);
  const stays: LocalStay[] = detectStays(points, P.stayRadiusM, P.stayMinMs).map((s) => {
    const off = offsetAt(s.from);
    return { lat: s.lat, lon: s.lon, from: s.from + off, to: s.to + off };
  });
  const all = clusterStays(stays, P.clusterRadiusM).map(metrics);

  const pick = (list: ClusterMetrics[], score: (m: ClusterMetrics) => number) =>
    list.reduce<ClusterMetrics | null>((b, m) => (!b || score(m) > score(b) ? m : b), null);

  const home = pick(
    all.filter((m) => m.nightDays >= P.minDays),
    (m) => m.nightMs,
  );
  const school = pick(
    all.filter((m) => m !== home && m.schoolDays >= P.minDays),
    (m) => m.schoolMs,
  );
  const frequent = all
    .filter((m) => m !== home && m !== school && m.presenceDays >= P.minDays)
    .sort((x, y) => y.presenceDays - x.presenceDays || y.cluster.totalMs - x.cluster.totalMs)
    .slice(0, P.maxFrequent);

  const out: ChildPlace[] = [];
  const base = (m: ClusterMetrics) => ({
    lat: m.cluster.lat,
    lon: m.cluster.lon,
    radius: suggestedRadius(m.cluster),
    daysWithData,
  });
  if (home) {
    out.push({
      kind: 'home',
      ...base(home),
      days: capDays(home.nightDays),
      typicalFromMin: null,
      typicalToMin: null,
    });
  }
  if (school) {
    out.push({
      kind: 'school',
      ...base(school),
      days: capDays(school.schoolDays),
      typicalFromMin: school.schoolFromMin,
      typicalToMin: school.schoolToMin,
    });
  }
  for (const m of frequent) {
    out.push({
      kind: 'frequent',
      ...base(m),
      days: capDays(m.presenceDays),
      typicalFromMin: m.typicalFromMin,
      typicalToMin: m.typicalToMin,
    });
  }
  return out;
}

// ─── Визиты в зону ──────────────────────────────────────────────────────────

export interface ZoneVisit {
  from: number; // мс UTC
  to: number;
  /** Визит не закончился — последняя точка периода внутри зоны. */
  ongoing: boolean;
}

// Визит засчитывается от 5 минут; между двумя точками внутри дольше 12 часов
// — это уже два визита (телефон молчал, а ребёнок мог уйти и вернуться).
const VISIT_MIN_MS = 5 * MIN_MS;
const VISIT_MAX_GAP_MS = 12 * 60 * MIN_MS;

/**
 * Визиты в круглую зону по хорошим точкам — с тем же гистерезисом, что у
 * детекции: «внутри» — dist ≤ R, «снаружи» — dist > R + B, B = max(30, 0.15R);
 * полоса между ними визит не рвёт. Одна точка-вылет снаружи — тоже.
 */
export function zoneVisits(
  points: TrackInputPoint[],
  zone: { lat: number; lon: number; radius: number },
): ZoneVisit[] {
  const B = Math.max(30, 0.15 * zone.radius);
  const d = points.map((p) => distanceMeters(zone.lat, zone.lon, p.lat, p.lon));
  const visits: ZoneVisit[] = [];
  let start: number | null = null;
  let lastIn = 0;
  const close = (ongoing: boolean) => {
    if (start !== null && lastIn - start >= VISIT_MIN_MS) {
      visits.push({ from: start, to: lastIn, ongoing });
    }
    start = null;
  };
  for (let i = 0; i < points.length; i++) {
    const t = points[i].t;
    const outside = d[i] > zone.radius + B;
    if (start === null) {
      if (d[i] <= zone.radius) {
        start = t;
        lastIn = t;
      }
      continue;
    }
    if (t - lastIn > VISIT_MAX_GAP_MS) {
      close(false);
      if (d[i] <= zone.radius) {
        start = t;
        lastIn = t;
      }
      continue;
    }
    if (!outside) {
      lastIn = t;
      continue;
    }
    if (i + 1 < points.length && d[i + 1] <= zone.radius + B) continue; // вылет
    close(false);
  }
  close(true);
  return visits;
}

export interface ZoneVisitStats {
  visits: number;
  totalSec: number;
  avgSec: number;
  daysCount: number;
  lastVisitFrom: number | null;
  lastVisitTo: number | null;
  ongoing: boolean;
  /** Медиана местного времени прихода и ухода, минуты дня. */
  typicalArrivalMin: number | null;
  typicalDepartureMin: number | null;
}

export function visitStats(visits: ZoneVisit[], tz: string): ZoneVisitStats {
  const totalMs = visits.reduce((a, v) => a + (v.to - v.from), 0);
  const local = (t: number) => t + tzOffsetMs(t, tz);
  const last = visits.at(-1) ?? null;
  const finished = visits.filter((v) => !v.ongoing);
  return {
    visits: visits.length,
    totalSec: Math.round(totalMs / 1000),
    avgSec: visits.length ? Math.round(totalMs / visits.length / 1000) : 0,
    daysCount: new Set(visits.map((v) => dayKey(local(v.from)))).size,
    lastVisitFrom: last?.from ?? null,
    lastVisitTo: last?.to ?? null,
    ongoing: last?.ongoing ?? false,
    typicalArrivalMin: median(visits.map((v) => minuteOfDay(local(v.from)))),
    typicalDepartureMin: median(finished.map((v) => minuteOfDay(local(v.to)))),
  };
}
