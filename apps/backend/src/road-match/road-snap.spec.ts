import { distanceMeters } from '../common/geo-distance';
import { snapTrack, splitModes, splitRuns } from './road-snap';
import type {
  MatchPoint,
  OsrmClient,
  OsrmMatchResponse,
  OsrmRouteResponse,
  SnapInputPoint,
  TravelMode,
} from './road-snap';

// Метров в градусе широты ~111 км; долготы на 48° ~74 км.
const M_LAT = 1 / 111_195;
const M_LON = 1 / 74_400;
const T0 = Date.parse('2026-10-09T08:00:00Z');

/** Прямолинейное движение на восток: n точек, шаг stepM за stepS секунд. */
function line(n: number, stepM: number, stepS: number, start = { lat: 48.48, lon: 135.08, t: T0 }) {
  return Array.from(
    { length: n },
    (_, i): SnapInputPoint => ({
      lat: start.lat,
      lon: start.lon + i * stepM * M_LON,
      t: start.t + i * stepS * 1000,
      accuracy: 8,
    }),
  );
}

// Дорога проходит в 10 м севернее точек: привязка сдвигает трек на неё.
const ROAD_OFFSET = 10 * M_LAT;

class FakeOsrm implements OsrmClient {
  calls: Array<{ kind: 'match' | 'route'; mode: TravelMode; n: number }> = [];
  matchImpl: (mode: TravelMode, pts: MatchPoint[]) => OsrmMatchResponse | null = (_m, pts) =>
    onRoad(pts);
  routeImpl: (
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
  ) => OsrmRouteResponse | null = (a, b) => ({
    code: 'Ok',
    routes: [
      {
        distance: distanceMeters(a.lat, a.lon, b.lat, b.lon) * 1.2,
        duration: 120,
        geometry: {
          coordinates: [
            [a.lon, a.lat + ROAD_OFFSET],
            [(a.lon + b.lon) / 2, a.lat + ROAD_OFFSET],
            [b.lon, b.lat + ROAD_OFFSET],
          ],
        },
      },
    ],
  });

  match(mode: TravelMode, points: MatchPoint[]): Promise<OsrmMatchResponse | null> {
    this.calls.push({ kind: 'match', mode, n: points.length });
    return Promise.resolve(this.matchImpl(mode, points));
  }

  route(
    mode: TravelMode,
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
  ): Promise<OsrmRouteResponse | null> {
    this.calls.push({ kind: 'route', mode, n: 2 });
    return Promise.resolve(this.routeImpl(a, b));
  }
}

/** Ответ /match: все точки привязаны к дороге в 10 м севернее, одна привязка. */
function onRoad(pts: MatchPoint[], confidence = 0.9): OsrmMatchResponse {
  const legs = pts.slice(1).map((b, i) => {
    const a = pts[i];
    return {
      distance: distanceMeters(a.lat, a.lon, b.lat, b.lon),
      steps: [
        {
          geometry: {
            coordinates: [
              [a.lon, a.lat + ROAD_OFFSET],
              [(a.lon + b.lon) / 2, a.lat + ROAD_OFFSET],
              [b.lon, b.lat + ROAD_OFFSET],
            ] as Array<[number, number]>,
          },
        },
      ],
    };
  });
  return {
    code: 'Ok',
    matchings: [{ confidence, distance: 0, legs }],
    tracepoints: pts.map((p, i) => ({
      matchings_index: 0,
      waypoint_index: i,
      location: [p.lon, p.lat + ROAD_OFFSET],
    })),
  };
}

function increasing(points: Array<{ t: number }>): boolean {
  return points.every((p, i) => i === 0 || p.t >= points[i - 1].t);
}

describe('splitRuns', () => {
  it('рвёт участок на стоянке (две вершины в одной точке) и на паузе без точек', () => {
    const a = line(5, 50, 10);
    const stayEnd = { ...a[4], t: a[4].t + 600_000 };
    const b = line(5, 50, 10, { lat: 48.48, lon: a[4].lon, t: stayEnd.t });
    const pause = line(3, 50, 10, { lat: 48.49, lon: 135.1, t: b[4].t + 300_000 });
    const runs = splitRuns([...a, stayEnd, ...b.slice(1), ...pause]);
    expect(runs.map((r) => r.length)).toEqual([5, 5, 3]);
  });
});

describe('splitModes', () => {
  it('пешком, потом транспорт — два куска с общей граничной точкой', () => {
    const walk = line(20, 14, 10); // 1.4 м/с
    const last = walk[walk.length - 1];
    const car = line(20, 150, 10, { lat: last.lat, lon: last.lon, t: last.t }).slice(1); // 15 м/с
    const parts = splitModes([...walk, ...car]);
    expect(parts.map((p) => p.mode)).toEqual(['foot', 'car']);
    expect(parts[0].to).toBe(parts[1].from);
  });

  it('короткая остановка машины у светофора не делает кусок пешеходным', () => {
    const a = line(15, 150, 10);
    const end = a[a.length - 1];
    const stop = Array.from({ length: 3 }, (_, i) => ({ ...end, t: end.t + (i + 1) * 10_000 }));
    const b = line(15, 150, 10, { lat: end.lat, lon: end.lon, t: stop[2].t + 10_000 });
    expect(splitModes([...a, ...stop, ...b]).map((p) => p.mode)).toEqual(['car']);
  });
});

describe('snapTrack', () => {
  it('привязывает движение к дороге, время не убывает', async () => {
    const osrm = new FakeOsrm();
    const pts = line(30, 150, 10);
    const r = await snapTrack(pts, osrm);
    expect(r.complete).toBe(true);
    expect(osrm.calls.every((c) => c.mode === 'car')).toBe(true);
    // Все точки на дороге: 10 м севернее исходной линии.
    for (const p of r.points) expect(p.lat).toBeCloseTo(48.48 + ROAD_OFFSET, 7);
    expect(r.points[0].t).toBe(pts[0].t);
    expect(r.points[r.points.length - 1].t).toBe(pts[pts.length - 1].t);
    expect(increasing(r.points)).toBe(true);
  });

  it('длинный участок режется на запросы по 100 точек с общей точкой на стыке', async () => {
    const osrm = new FakeOsrm();
    const r = await snapTrack(line(250, 150, 10), osrm);
    expect(osrm.calls.map((c) => c.n)).toEqual([100, 100, 52]);
    expect(increasing(r.points)).toBe(true);
    const lons = r.points.map((p) => p.lon);
    expect(new Set(lons).size).toBe(lons.length); // стыки без дублей
  });

  it('низкая уверенность — остаётся исходная линия', async () => {
    const osrm = new FakeOsrm();
    osrm.matchImpl = (_m, pts) => onRoad(pts, 0.05);
    const pts = line(10, 150, 10);
    const r = await snapTrack(pts, osrm);
    expect(r.points.map((p) => p.lat)).toEqual(pts.map((p) => p.lat));
    expect(r.complete).toBe(true);
  });

  it('нога с крюком заменяется прямой между исходными точками', async () => {
    const osrm = new FakeOsrm();
    osrm.matchImpl = (_m, pts) => {
      const resp = onRoad(pts);
      resp.matchings![0].legs[3].distance = 5000; // петля вместо 150 м
      return resp;
    };
    const pts = line(8, 150, 10);
    const r = await snapTrack(pts, osrm);
    expect(r.points.some((p) => p.lat === pts[3].lat && p.lon === pts[3].lon)).toBe(true);
    expect(r.points.some((p) => p.lat === pts[4].lat && p.lon === pts[4].lon)).toBe(true);
    expect(increasing(r.points)).toBe(true);
  });

  it('«отросток» в боковую улицу внутри ноги заменяется исходной линией', async () => {
    const osrm = new FakeOsrm();
    osrm.matchImpl = (_m, pts) => {
      const resp = onRoad(pts);
      const a = pts[2];
      const b = pts[3];
      const mid = (a.lon + b.lon) / 2;
      // Туда-обратно на 120 м к югу посреди ноги; по длине в допуск укладывается.
      resp.matchings![0].legs[2].steps[0].geometry.coordinates = [
        [a.lon, a.lat + ROAD_OFFSET],
        [mid, a.lat + ROAD_OFFSET],
        [mid, a.lat - 120 * M_LAT],
        [mid, a.lat + ROAD_OFFSET],
        [b.lon, b.lat + ROAD_OFFSET],
      ];
      return resp;
    };
    const pts = line(6, 150, 10);
    const r = await snapTrack(pts, osrm);
    expect(Math.min(...r.points.map((p) => p.lat))).toBeGreaterThan(48.48 - 5 * M_LAT);
    expect(r.points.some((p) => p.lat === pts[2].lat && p.lon === pts[2].lon)).toBe(true);
  });

  it('«отросток» на стыке двух ног (точка привязана к боковой улице) — обе ноги исходной линией', async () => {
    const osrm = new FakeOsrm();
    osrm.matchImpl = (_m, pts) => {
      const resp = onRoad(pts);
      const side: [number, number] = [pts[3].lon, pts[3].lat - 120 * M_LAT];
      const prev = resp.matchings![0].legs[2].steps[0].geometry.coordinates;
      prev[prev.length - 1] = side;
      const next = resp.matchings![0].legs[3].steps[0].geometry.coordinates;
      next[0] = side;
      next.splice(1, 0, [pts[3].lon, pts[3].lat + ROAD_OFFSET]);
      prev.splice(prev.length - 1, 0, [pts[3].lon, pts[3].lat + ROAD_OFFSET]);
      return resp;
    };
    const pts = line(7, 150, 10);
    const r = await snapTrack(pts, osrm);
    expect(Math.min(...r.points.map((p) => p.lat))).toBeGreaterThan(48.48 - 5 * M_LAT);
    expect(increasing(r.points)).toBe(true);
  });

  it('настоящий разворот, записанный точками телефона, остаётся', async () => {
    const osrm = new FakeOsrm();
    // Едет на восток 4 точки и возвращается тем же путём.
    const there = line(5, 150, 10);
    const back = there
      .slice(0, 4)
      .reverse()
      .map((p, k) => ({ ...p, t: there[4].t + (k + 1) * 10_000 }));
    const pts = [...there, ...back];
    const r = await snapTrack(pts, osrm);
    // Все точки привязаны к дороге (10 м севернее), исходных среди них нет.
    for (const p of r.points) expect(p.lat).toBeCloseTo(48.48 + ROAD_OFFSET, 7);
  });

  it('точки, которые OSRM не привязал, остаются как есть', async () => {
    const osrm = new FakeOsrm();
    osrm.matchImpl = (_m, pts) => {
      const head = onRoad(pts.slice(0, 5));
      return { ...head, tracepoints: [...head.tracepoints!, ...pts.slice(5).map(() => null)] };
    };
    const pts = line(8, 150, 10);
    const r = await snapTrack(pts, osrm);
    expect(r.points.slice(-3).map((p) => p.lon)).toEqual(pts.slice(-3).map((p) => p.lon));
    expect(r.points[0].lat).toBeCloseTo(48.48 + ROAD_OFFSET, 7);
  });

  it('NoMatch — исходная линия, трек при этом полный', async () => {
    const osrm = new FakeOsrm();
    osrm.matchImpl = () => ({ code: 'NoMatch' });
    const pts = line(6, 14, 10);
    const r = await snapTrack(pts, osrm);
    expect(r.points.map((p) => p.lon)).toEqual(pts.map((p) => p.lon));
    expect(r.complete).toBe(true);
  });

  it('OSRM недоступен — исходная линия и complete=false', async () => {
    const osrm = new FakeOsrm();
    osrm.matchImpl = () => null;
    const pts = line(6, 150, 10);
    const r = await snapTrack(pts, osrm);
    expect(r.points.map((p) => p.lon)).toEqual(pts.map((p) => p.lon));
    expect(r.complete).toBe(false);
  });

  it('разрыв без данных достраивается по дороге пунктиром (inferred)', async () => {
    const osrm = new FakeOsrm();
    const a = line(5, 150, 10);
    const end = a[a.length - 1];
    // 10 минут без точек, 2 км восточнее.
    const b = line(5, 150, 10, { lat: end.lat, lon: end.lon + 2000 * M_LON, t: end.t + 600_000 });
    const r = await snapTrack([...a, ...b], osrm);
    const inferred = r.points.filter((p) => p.inferred);
    expect(inferred.length).toBe(3);
    expect(osrm.calls.find((c) => c.kind === 'route')?.mode).toBe('car');
    expect(inferred.every((p) => p.t >= end.t && p.t <= b[0].t)).toBe(true);
    expect(increasing(r.points)).toBe(true);
  });

  it('разрыв не достраивается, если по дороге так быстро не доехать', async () => {
    const osrm = new FakeOsrm();
    const base = osrm.routeImpl;
    osrm.routeImpl = (a, b) => {
      const resp = base(a, b)!;
      resp.routes![0].duration = 3600; // час по дороге против 10 минут разрыва
      return resp;
    };
    const a = line(5, 150, 10);
    const end = a[a.length - 1];
    const b = line(5, 150, 10, { lat: end.lat, lon: end.lon + 2000 * M_LON, t: end.t + 600_000 });
    const r = await snapTrack([...a, ...b], osrm);
    expect(r.points.some((p) => p.inferred)).toBe(false);
  });

  it('короткий разрыв (меньше 300 м) и стоянка не достраиваются', async () => {
    const osrm = new FakeOsrm();
    const a = line(5, 14, 10);
    const end = a[a.length - 1];
    const stayEnd = { ...end, t: end.t + 900_000 };
    const b = line(5, 14, 10, { lat: end.lat, lon: end.lon, t: stayEnd.t }).slice(1);
    const r = await snapTrack([...a, stayEnd, ...b], osrm);
    expect(osrm.calls.some((c) => c.kind === 'route')).toBe(false);
    expect(r.points.some((p) => p.inferred)).toBe(false);
  });
});
