import { buildTrack, detectStays, pathLength, segmentTrips } from './track-builder';
import type { TrackInputPoint } from './track-builder';
import { distanceMeters } from '../common/geo-distance';

const LAT0 = 48.48;
const LON0 = 135.08;
const M_PER_DEG = 111_195;

function pt(dNorthM: number, tMin: number, accuracy = 10, dEastM = 0): TrackInputPoint {
  return {
    lat: LAT0 + dNorthM / M_PER_DEG,
    lon: LON0 + dEastM / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)),
    t: tMin * 60_000,
    accuracy,
  };
}

// Дрожь на месте: ±25 м вокруг (north, east), точка раз в минуту.
function jitter(north: number, fromMin: number, minutes: number): TrackInputPoint[] {
  return Array.from({ length: minutes + 1 }, (_, i) =>
    pt(north + (i % 2 ? 25 : -25), fromMin + i, 20, i % 3 ? 20 : -20),
  );
}

// Движение на север со скоростью ~80 м/мин.
function walk(fromNorth: number, toNorth: number, fromMin: number): TrackInputPoint[] {
  const steps = Math.round(Math.abs(toNorth - fromNorth) / 80);
  return Array.from({ length: steps }, (_, i) =>
    pt(fromNorth + ((toNorth - fromNorth) * (i + 1)) / steps, fromMin + i + 1, 8),
  );
}

describe('detectStays', () => {
  it('находит стоянку в дрожи и не находит в движении', () => {
    const pts = [...jitter(0, 0, 20), ...walk(0, 2000, 20)];
    const stays = detectStays(pts, 70, 3 * 60_000);
    expect(stays).toHaveLength(1);
    expect(stays[0].from).toBe(0);
    expect(stays[0].to).toBe(20 * 60_000);
  });

  it('одиночный вылет не рвёт стоянку', () => {
    const pts = [...jitter(0, 0, 10), pt(400, 10.5), ...jitter(0, 11, 10)];
    expect(detectStays(pts, 70, 3 * 60_000)).toHaveLength(1);
  });
});

describe('buildTrack', () => {
  it('клубок стоянки сворачивается в две вершины в центре', () => {
    const pts = [...jitter(0, 0, 20), ...walk(0, 800, 20)];
    const track = buildTrack(pts, 70, 3 * 60_000);
    expect(track.stays).toHaveLength(1);
    expect(track.points[0].lat).toBe(track.points[1].lat);
    expect([track.points[0].t, track.points[1].t]).toEqual([0, 20 * 60_000]);
    expect(track.points).toHaveLength(2 + 10);
    // Длина — это путь, а не дрожь: ~800 м, без сотен метров «клубка».
    expect(pathLength(track.points)).toBeGreaterThan(750);
    expect(pathLength(track.points)).toBeLessThan(900);
  });
});

describe('сглаживание', () => {
  it('гасит дрожь грубых точек на прямой', () => {
    // Идёт на север, грубые точки (±30 м) шатаются на ±25 м в стороны.
    const pts = Array.from({ length: 30 }, (_, i) => pt(i * 10, i / 10, 30, i % 2 ? 25 : -25));
    const track = buildTrack(pts, 70, 3 * 60_000);
    const raw = pathLength(pts);
    const smooth = pathLength(track.points);
    expect(smooth).toBeLessThan(raw * 0.6);
  });

  it('точные точки на повороте почти не сдвигает (угол не срезан)', () => {
    // Г-образный поворот, точность ±4 м, шаг 10 м / 7 с.
    const leg1 = Array.from({ length: 10 }, (_, i) => pt(i * 10, (i * 7) / 60, 4));
    const leg2 = Array.from({ length: 10 }, (_, i) => pt(90, ((10 + i) * 7) / 60, 4, (i + 1) * 10));
    const pts = [...leg1, ...leg2];
    const track = buildTrack(pts, 70, 3 * 60_000);
    const corner = track.points[9];
    const d = distanceMeters(corner.lat, corner.lon, pts[9].lat, pts[9].lon);
    expect(d).toBeLessThan(3);
  });
});

describe('segmentTrips', () => {
  const params = { idleMs: 30 * 60_000, idleRadiusM: 70, stopMinMs: 3 * 60_000 };

  it('дрожь на месте весь день — ни одной поездки', () => {
    const pts = jitter(0, 0, 240);
    expect(segmentTrips(pts, { ...params, now: 241 * 60_000 })).toEqual([]);
  });

  it('поездка начинается с отъезда и кончается приездом, а не за 30 мин до/после', () => {
    // Дом 0..60 мин, дорога 25 мин (2 км), школа 85..180 мин.
    const pts = [...jitter(0, 0, 60), ...walk(0, 2000, 60), ...jitter(2000, 86, 94)];
    const trips = segmentTrips(pts, { ...params, now: 181 * 60_000 });
    expect(trips).toHaveLength(1);
    const t = trips[0];
    expect(t.startedAt).toBe(60 * 60_000);
    // Последняя точка дороги (85 мин) уже у школы — это и есть приезд.
    expect(t.endedAt).toBe(85 * 60_000);
    expect(t.isActive).toBe(false);
    expect(t.distanceM).toBeGreaterThan(1900);
    expect(t.distanceM).toBeLessThan(2200);
  });

  it('едет прямо сейчас — активная поездка', () => {
    const pts = [...jitter(0, 0, 60), ...walk(0, 1000, 60)];
    const trips = segmentTrips(pts, { ...params, now: 73 * 60_000 });
    expect(trips).toHaveLength(1);
    expect(trips[0].isActive).toBe(true);
  });

  it('короткая остановка (10 мин) поездку не делит', () => {
    const pts = [
      ...jitter(0, 0, 40),
      ...walk(0, 1000, 40),
      ...jitter(1000, 53, 10),
      ...walk(1000, 2000, 63),
      ...jitter(2000, 76, 40),
    ];
    expect(segmentTrips(pts, { ...params, now: 117 * 60_000 })).toHaveLength(1);
  });

  it('разрыв без точек дольше часа делит поездку (нет «поездки через ночь»)', () => {
    // Вечером прошёл 1 км, телефон замолчал на 9 часов, утром ещё 1 км.
    const evening = [...jitter(0, 0, 40), ...walk(0, 1000, 40)];
    const morning = walk(1000, 2000, 600);
    const trips = segmentTrips([...evening, ...morning], { ...params, now: 700 * 60_000 });
    expect(trips).toHaveLength(2);
    expect(trips.every((t) => t.endedAt - t.startedAt < 60 * 60_000)).toBe(true);
  });
});
