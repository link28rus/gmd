import { distanceMeters } from '../common/geo-distance';

// v0.80.0 — привязка трека к дорогам (map matching) через OSRM.
//
// На вход — уже очищенный трек (track-builder: стоянки свёрнуты в две
// вершины, движение сглажено). Трек режется на участки движения, каждый —
// на куски «транспорт» / «пешком» по скорости; транспорт привязывается к
// графу car, пешеход — к графу foot. Где привязка не удалась или выглядит
// нелепо (петля, крюк, скорость выше возможной) — остаётся исходная линия.
// Разрывы без данных до часа достраиваются кратчайшим путём по дорогам и
// помечаются inferred: клиент рисует их пунктиром.
//
// Чистая логика: сетевой клиент передаётся снаружи (RoadMatchService), в
// тестах — подмена.

export type TravelMode = 'car' | 'foot';

export interface SnapInputPoint {
  lat: number;
  lon: number;
  t: number; // мс
  accuracy?: number | null;
}

export interface SnapOutPoint {
  lat: number;
  lon: number;
  t: number;
  /** Достроено по дороге в разрыве без данных — «скорее всего ехал так». */
  inferred?: true;
}

export interface OsrmLeg {
  distance: number;
  steps: Array<{ geometry: { coordinates: Array<[number, number]> } }>;
}

export interface OsrmMatchResponse {
  code: string;
  matchings?: Array<{ confidence: number; distance: number; legs: OsrmLeg[] }>;
  tracepoints?: Array<{
    matchings_index: number;
    waypoint_index: number;
    location: [number, number];
  } | null>;
}

export interface OsrmRouteResponse {
  code: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry: { coordinates: Array<[number, number]> };
  }>;
}

export interface MatchPoint {
  lat: number;
  lon: number;
  t: number;
  radius: number;
}

/** null — сеть/таймаут/сервер недоступен (не «нет совпадения»). */
export interface OsrmClient {
  match(mode: TravelMode, points: MatchPoint[]): Promise<OsrmMatchResponse | null>;
  route(
    mode: TravelMode,
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
  ): Promise<OsrmRouteResponse | null>;
}

export interface SnapResult {
  points: SnapOutPoint[];
  /** false — часть запросов к OSRM не дошла; пробег по такому треку не сохраняем. */
  complete: boolean;
}

// Средняя скорость участка, с которой считаем его транспортом, м/с
// (~14 км/ч: быстрее бега и большинства детских самокатов).
export const CAR_SPEED_MPS = 4;
// Пауза без точек, после которой участок движения рвётся (как в track-builder).
const RUN_GAP_MS = 120_000;
// Кусок режима короче — сливается с соседним: остановка у светофора не
// делает пешехода из машины.
const MODE_MIN_MS = 60_000;
// Окно медианы скорости, точек.
const SPEED_WINDOW = 5;
// OSRM по умолчанию принимает не больше 100 точек в /match.
const MATCH_CHUNK = 100;
// Привязку с меньшей уверенностью не берём.
const MIN_CONFIDENCE = 0.2;
// Отрезок по дороге длиннее прямой в столько раз (+ запас) — крюк/петля.
const LEG_DETOUR_RATIO = 2.5;
const LEG_DETOUR_SLACK_M = 150;
const MAX_SPEED_MPS = 70;
// Разрывы без данных: достраиваем, если не дольше часа (длиннее — поездка
// всё равно делится, track-builder TRIP_GAP_SPLIT_MS) и не короче 300 м
// (клиент рисует разрыв только от 300 м, track-gaps).
const FILL_MAX_GAP_MS = 60 * 60_000;
const FILL_MIN_DIST_M = 300;
// Средняя скорость через разрыв, выше которой достраиваем по графу car.
const FILL_CAR_SPEED_MPS = 2.2;
const FILL_DETOUR_RATIO = 2.5;
const FILL_DETOUR_SLACK_M = 500;
// Стоянка в треке — две вершины в одной точке.
const SAME_PLACE_M = 1;

type Pt = { lat: number; lon: number };

function dist(a: Pt, b: Pt): number {
  return distanceMeters(a.lat, a.lon, b.lat, b.lon);
}

function plain(p: SnapInputPoint): SnapOutPoint {
  return { lat: p.lat, lon: p.lon, t: p.t };
}

/** Участки непрерывного движения: рвутся на стоянках и паузах без точек. */
export function splitRuns(points: SnapInputPoint[]): SnapInputPoint[][] {
  const runs: SnapInputPoint[][] = [];
  let run: SnapInputPoint[] = [];
  for (const p of points) {
    const prev = run[run.length - 1];
    if (prev && (p.t - prev.t > RUN_GAP_MS || dist(prev, p) < SAME_PLACE_M)) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Режим у каждой точки участка: медиана скорости в окне ≥ CAR_SPEED_MPS —
 * транспорт. Короткие куски сливаются с предыдущим (первый — со следующим).
 * Возвращает куски [from, to] по индексам; соседние делят граничную точку.
 */
export function splitModes(
  run: SnapInputPoint[],
  carSpeedMps = CAR_SPEED_MPS,
): Array<{ mode: TravelMode; from: number; to: number }> {
  const n = run.length;
  if (n < 2) return [{ mode: 'foot', from: 0, to: n - 1 }];
  const v = new Array<number>(n);
  for (let k = 1; k < n; k++) {
    v[k] = dist(run[k - 1], run[k]) / Math.max(1, (run[k].t - run[k - 1].t) / 1000);
  }
  v[0] = v[1];
  const half = Math.floor(SPEED_WINDOW / 2);
  const modes = v.map((_, k): TravelMode => {
    const w = v.slice(Math.max(0, k - half), Math.min(n, k + half + 1));
    return median(w) >= carSpeedMps ? 'car' : 'foot';
  });
  let parts: Array<{ mode: TravelMode; from: number; to: number }> = [];
  for (let k = 0; k < n; k++) {
    const last = parts[parts.length - 1];
    if (last && last.mode === modes[k]) last.to = k;
    else parts.push({ mode: modes[k], from: last ? last.to : k, to: k });
  }
  // Слияние коротких: каждый проход убирает самый короткий кусок, пока такие есть.
  const dur = (p: { from: number; to: number }): number => run[p.to].t - run[p.from].t;
  while (parts.length > 1) {
    let idx = -1;
    for (let i = 0; i < parts.length; i++) {
      if (dur(parts[i]) < MODE_MIN_MS && (idx < 0 || dur(parts[i]) < dur(parts[idx]))) idx = i;
    }
    if (idx < 0) break;
    const target = idx === 0 ? 1 : idx - 1;
    const a = Math.min(idx, target);
    const merged = { mode: parts[target].mode, from: parts[a].from, to: parts[a + 1].to };
    parts = [...parts.slice(0, a), merged, ...parts.slice(a + 2)];
  }
  // После слияния соседние куски одного режима склеиваем.
  const out: typeof parts = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.mode === p.mode) last.to = p.to;
    else out.push({ ...p });
  }
  return out;
}

function radiusFor(mode: TravelMode, accuracy: number | null | undefined): number {
  // radiuses в OSRM — стандартное отклонение GPS, поиск дорог идёт в ~3 таких
  // радиусах. Пешеходу держим уже: двор без дорожек в OSM не должен
  // «прыгать» на соседнюю улицу.
  const a = accuracy ?? 15;
  return mode === 'car' ? Math.min(25, Math.max(5, a)) : Math.min(15, Math.max(4, a));
}

/** Вершины геометрии ноги со временем, разложенным по пройденному пути. */
function legPoints(coords: Array<[number, number]>, t0: number, t1: number): SnapOutPoint[] {
  const pts = coords.map(([lon, lat]) => ({ lat, lon }));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  return pts.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    t: Math.round(
      total > 0
        ? t0 + ((t1 - t0) * cum[i]) / total
        : t0 + ((t1 - t0) * i) / Math.max(1, pts.length - 1),
    ),
  }));
}

function legCoords(leg: OsrmLeg): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of leg.steps) {
    for (const c of s.geometry.coordinates) {
      const last = out[out.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
    }
  }
  return out;
}

/** Нога выглядит правдоподобно: без крюка и без сверхскорости. */
function plausibleLeg(meters: number, a: SnapInputPoint, b: SnapInputPoint): boolean {
  const straight = dist(a, b);
  const dt = Math.max(1, (b.t - a.t) / 1000);
  return meters <= straight * LEG_DETOUR_RATIO + LEG_DETOUR_SLACK_M && meters / dt <= MAX_SPEED_MPS;
}

// Локальная плоская проекция в метрах вокруг точки o — для углов и
// расстояний до отрезка на масштабе сотен метров её хватает.
function toXY(p: Pt, o: Pt): { x: number; y: number } {
  const k = Math.cos((o.lat * Math.PI) / 180);
  return { x: (p.lon - o.lon) * 111_320 * k, y: (p.lat - o.lat) * 110_574 };
}

/** Расстояние от p до отрезка a–b, м. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const P = toXY(p, a);
  const B = toXY(b, a);
  const len2 = B.x * B.x + B.y * B.y;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (P.x * B.x + P.y * B.y) / len2)) : 0;
  return Math.hypot(P.x - t * B.x, P.y - t * B.y);
}

/** В вершине v линия разворачивается назад (угол между отрезками ≥ 150°). */
function reverses(prev: Pt, v: Pt, next: Pt): boolean {
  const a = toXY(prev, v);
  const b = toXY(next, v);
  const la = Math.hypot(a.x, a.y);
  const lb = Math.hypot(b.x, b.y);
  if (la < 1 || lb < 1) return false;
  return (a.x * b.x + a.y * b.y) / (la * lb) > SPUR_COS;
}

// Разворот привязанной линии дальше этого от записанного трека — «отросток».
const SPUR_M = 25;
// cos(30°): угол между входящим и выходящим отрезком меньше 30° — разворот.
const SPUR_COS = Math.cos((30 * Math.PI) / 180);

/**
 * «Отростки» — типичная ошибка HMM-привязки: точку у перекрёстка относит на
 * боковую улицу, и линия сходит туда и возвращается тем же путём (на проде
 * 2026-10-09 — 120 м в переулок у трассы). Крюк по длине такой ноги в допуск
 * укладывается, поэтому ищем сам разворот: вершина, где линия идёт назад и
 * которая дальше SPUR_M от записанного трека. Настоящий разворот (уехал не
 * туда, вернулся) записан точками телефона — рядом с ним трек есть.
 * Ноги с отростком (внутри ноги или на стыке двух) заменяются исходной линией.
 */
function markSpurs(
  legs: Array<{ coords: Array<[number, number]>; good: boolean }>,
  wps: number[],
  chunk: SnapInputPoint[],
): void {
  const at = (c: [number, number]): Pt => ({ lat: c[1], lon: c[0] });
  // Ближайший к v участок записанного трека между точками wps[from]..wps[to].
  const offTrack = (v: Pt, from: number, to: number): boolean => {
    for (let j = wps[Math.max(0, from)]; j < wps[Math.min(wps.length - 1, to)]; j++) {
      if (distToSegment(v, chunk[j], chunk[j + 1]) <= SPUR_M) return false;
    }
    return true;
  };
  legs.forEach((leg, w) => {
    if (!leg.good) return;
    const c = leg.coords;
    for (let v = 1; v + 1 < c.length; v++) {
      if (reverses(at(c[v - 1]), at(c[v]), at(c[v + 1])) && offTrack(at(c[v]), w, w + 1)) {
        leg.good = false;
        return;
      }
    }
  });
  // Стык: конец ноги w-1 и начало ноги w сходятся в привязанной точке.
  for (let w = 1; w < legs.length; w++) {
    const p = legs[w - 1].coords;
    const n = legs[w].coords;
    if (p.length < 2 || n.length < 2) continue;
    if (reverses(at(p[p.length - 2]), at(n[0]), at(n[1])) && offTrack(at(n[0]), w - 1, w + 1)) {
      legs[w - 1].good = false;
      legs[w].good = false;
    }
  }
}

/** Один запрос /match (≤ MATCH_CHUNK точек). Возвращает линию от первой до последней точки куска. */
async function matchChunk(
  client: OsrmClient,
  mode: TravelMode,
  chunk: SnapInputPoint[],
): Promise<{ points: SnapOutPoint[]; ok: boolean }> {
  const resp = await client.match(
    mode,
    chunk.map((p) => ({ lat: p.lat, lon: p.lon, t: p.t, radius: radiusFor(mode, p.accuracy) })),
  );
  if (!resp) return { points: chunk.map(plain), ok: false };
  if (resp.code !== 'Ok' || !resp.matchings || !resp.tracepoints) {
    return { points: chunk.map(plain), ok: true };
  }
  const tps = resp.tracepoints;
  const out: SnapOutPoint[] = [];
  const push = (p: SnapOutPoint): void => {
    const last = out[out.length - 1];
    if (last && last.lat === p.lat && last.lon === p.lon) return;
    out.push(p);
  };
  let i = 0;
  while (i < chunk.length) {
    const tp = tps[i];
    if (!tp) {
      push(plain(chunk[i]));
      i++;
      continue;
    }
    const m = tp.matchings_index;
    // Точки этой привязки: подряд, кроме выброшенных OSRM (tracepoint null).
    const wps: number[] = [i];
    let k = i + 1;
    while (k < chunk.length && (tps[k] === null || tps[k]?.matchings_index === m)) {
      if (tps[k]) wps.push(k);
      k++;
    }
    const lastWp = wps[wps.length - 1];
    const matching = resp.matchings[m];
    if (!matching || matching.confidence < MIN_CONFIDENCE || wps.length < 2) {
      for (let j = i; j <= lastWp; j++) push(plain(chunk[j]));
      i = lastWp + 1;
      continue;
    }
    wps.sort((x, y) => (tps[x]?.waypoint_index ?? 0) - (tps[y]?.waypoint_index ?? 0));
    const legs = wps.slice(0, -1).map((from, w) => {
      const leg = matching.legs[w];
      const coords = leg ? legCoords(leg) : [];
      const good =
        !!leg && coords.length >= 2 && plausibleLeg(leg.distance, chunk[from], chunk[wps[w + 1]]);
      return { coords, good };
    });
    markSpurs(legs, wps, chunk);
    legs.forEach(({ coords, good }, w) => {
      if (!good) {
        for (let j = wps[w]; j <= wps[w + 1]; j++) push(plain(chunk[j]));
        return;
      }
      for (const p of legPoints(coords, chunk[wps[w]].t, chunk[wps[w + 1]].t)) push(p);
    });
    i = lastWp + 1;
  }
  return { points: out, ok: true };
}

async function matchPart(
  client: OsrmClient,
  mode: TravelMode,
  part: SnapInputPoint[],
): Promise<{ points: SnapOutPoint[]; ok: boolean }> {
  if (part.length < 2) return { points: part.map(plain), ok: true };
  const out: SnapOutPoint[] = [];
  let ok = true;
  // Куски с общей граничной точкой: стык ложится на одну и ту же точку.
  for (let s = 0; s < part.length - 1; s += MATCH_CHUNK - 1) {
    const chunk = part.slice(s, s + MATCH_CHUNK);
    const r = await matchChunk(client, mode, chunk);
    ok &&= r.ok;
    out.push(...(out.length > 0 ? r.points.slice(1) : r.points));
  }
  return { points: out, ok };
}

/** Достройка разрыва A→B по дороге; null — не достраиваем. */
async function fillGap(
  client: OsrmClient,
  a: SnapInputPoint,
  b: SnapInputPoint,
): Promise<{ points: SnapOutPoint[] | null; ok: boolean }> {
  const dt = b.t - a.t;
  const straight = dist(a, b);
  if (dt > FILL_MAX_GAP_MS || straight < FILL_MIN_DIST_M) return { points: null, ok: true };
  const mode: TravelMode = straight / Math.max(1, dt / 1000) >= FILL_CAR_SPEED_MPS ? 'car' : 'foot';
  const resp = await client.route(mode, a, b);
  if (!resp) return { points: null, ok: false };
  const route = resp.code === 'Ok' ? resp.routes?.[0] : undefined;
  if (
    !route ||
    route.geometry.coordinates.length < 2 ||
    route.distance > straight * FILL_DETOUR_RATIO + FILL_DETOUR_SLACK_M ||
    // Быстрее, чем по дороге вообще можно было доехать, — значит, ехал не так.
    route.duration > (dt / 1000) * 1.3 + 120
  ) {
    return { points: null, ok: true };
  }
  const pts = legPoints(route.geometry.coordinates, a.t, b.t).map(
    (p): SnapOutPoint => ({ ...p, inferred: true }),
  );
  return { points: pts, ok: true };
}

/**
 * Трек, привязанный к дорогам. Точки стоянок и всё, что не удалось привязать,
 * остаются как есть; порядок по времени сохраняется.
 */
export async function snapTrack(
  points: SnapInputPoint[],
  client: OsrmClient,
  carSpeedMps = CAR_SPEED_MPS,
): Promise<SnapResult> {
  const runs = splitRuns(points);
  const out: SnapOutPoint[] = [];
  let complete = true;
  let prevEnd: SnapInputPoint | undefined;
  for (const run of runs) {
    if (prevEnd) {
      const gap = await fillGap(client, prevEnd, run[0]);
      complete &&= gap.ok;
      if (gap.points) out.push(...gap.points);
    }
    for (const part of splitModes(run, carSpeedMps)) {
      const slice = run.slice(part.from, part.to + 1);
      const r = await matchPart(client, part.mode, slice);
      complete &&= r.ok;
      // Стык кусков разных режимов — общая точка; второй раз не кладём.
      out.push(...(part.from > 0 ? r.points.slice(1) : r.points));
    }
    prevEnd = run[run.length - 1];
  }
  return { points: out, complete };
}
