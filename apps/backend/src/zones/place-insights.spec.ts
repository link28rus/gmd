import { childPlaces, dailyOverlap, tzOffsetMs, visitStats, zoneVisits } from './place-insights';
import type { TrackInputPoint } from '../locations/track-builder';

const TZ = 'Asia/Vladivostok'; // UTC+10, без перехода на летнее время
const LAT0 = 48.48;
const LON0 = 135.08;
const M_PER_DEG = 111_195;
const MIN = 60_000;
const HOUR = 60 * MIN;

// 2026-09-07 — понедельник. Местная полночь этого дня в UTC.
const MON0 = Date.UTC(2026, 8, 7) - 10 * HOUR;

function at(day: number, hh: number, mm = 0): number {
  return MON0 + day * 24 * HOUR + hh * HOUR + mm * MIN;
}

function pt(northM: number, eastM: number, t: number, accuracy = 20): TrackInputPoint {
  return {
    lat: LAT0 + northM / M_PER_DEG,
    lon: LON0 + eastM / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)),
    t,
    accuracy,
  };
}

// Сидим на месте с дрожью ±20 м, точка каждые `stepMin` минут.
function sit(northM: number, eastM: number, from: number, to: number, stepMin = 30) {
  const out: TrackInputPoint[] = [];
  let i = 0;
  for (let t = from; t <= to; t += stepMin * MIN, i++) {
    out.push(pt(northM + (i % 2 ? 20 : -20), eastM + (i % 3 ? 15 : -15), t));
  }
  return out;
}

// Переезд: точки по прямой раз в минуту со скоростью ~300 м/мин.
function move(from: [number, number], to: [number, number], t0: number) {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.round(dist / 300));
  return Array.from({ length: steps - 1 }, (_, i) => {
    const k = (i + 1) / steps;
    return pt(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, t0 + (i + 1) * MIN);
  });
}

const HOME: [number, number] = [0, 0];
const SCHOOL: [number, number] = [2000, 1000];
const CLUB: [number, number] = [-1500, 2500];

/** Будний день: ночь дома → школа 08:10–13:40 → (кружок) → дом. */
function weekday(day: number, club = false): TrackInputPoint[] {
  const pts: TrackInputPoint[] = [];
  pts.push(...sit(...HOME, at(day, 0), at(day, 7, 30)));
  pts.push(...move(HOME, SCHOOL, at(day, 7, 50)));
  pts.push(...sit(...SCHOOL, at(day, 8, 10), at(day, 13, 40), 10));
  if (club) {
    pts.push(...move(SCHOOL, CLUB, at(day, 14)));
    pts.push(...sit(...CLUB, at(day, 16), at(day, 17, 30), 10));
    pts.push(...move(CLUB, HOME, at(day, 17, 40)));
  } else {
    pts.push(...move(SCHOOL, HOME, at(day, 13, 50)));
  }
  pts.push(...sit(...HOME, at(day, 18), at(day, 23, 59)));
  return pts;
}

describe('tzOffsetMs', () => {
  it('Владивосток +10 ч, Москва +3 ч', () => {
    expect(tzOffsetMs(MON0, TZ)).toBe(10 * HOUR);
    expect(tzOffsetMs(MON0, 'Europe/Moscow')).toBe(3 * HOUR);
  });
});

describe('dailyOverlap', () => {
  const local = (d: number, h: number) => Date.UTC(2026, 8, 7 + d, h);

  it('ночь через полночь относится к дню вечера', () => {
    const o = dailyOverlap(local(0, 21), local(1, 8), 22 * 60, 7 * 60);
    expect(o).toEqual([{ day: '2026-09-07', weekday: 1, ms: 9 * HOUR }]);
  });

  it('дневное окно режется по дням', () => {
    const o = dailyOverlap(local(0, 12), local(1, 9), 8 * 60, 15 * 60);
    expect(o.map((x) => [x.day, x.ms / HOUR])).toEqual([
      ['2026-09-07', 3],
      ['2026-09-08', 1],
    ]);
  });
});

describe('childPlaces', () => {
  it('находит дом, школу и частое место по неделе', () => {
    const pts = [0, 1, 2, 3, 4].flatMap((d) => weekday(d, d % 2 === 0));
    const places = childPlaces(pts, TZ);
    expect(places.map((p) => p.kind)).toEqual(['home', 'school', 'frequent']);

    const [home, school, club] = places;
    expect(home.days).toBeGreaterThanOrEqual(4);
    expect(home.daysWithData).toBe(5);
    expect(home.typicalFromMin).toBeNull();
    expect(dist(home, HOME)).toBeLessThan(40);

    expect(school.days).toBe(5);
    expect(dist(school, SCHOOL)).toBeLessThan(40);
    expect(school.typicalFromMin).toBe(8 * 60 + 10);
    expect(school.typicalToMin).toBe(13 * 60 + 40);

    expect(club.days).toBe(3);
    expect(dist(club, CLUB)).toBeLessThan(40);
    expect(club.typicalFromMin).toBe(16 * 60);
    expect(club.typicalToMin).toBe(17 * 60 + 30);

    for (const p of places) {
      expect(p.radius).toBeGreaterThanOrEqual(150);
      expect(p.radius).toBeLessThanOrEqual(300);
    }
  });

  it('двух дней мало — подсказок нет', () => {
    const pts = [0, 1].flatMap((d) => weekday(d, true));
    expect(childPlaces(pts, TZ)).toEqual([]);
  });

  it('школа только по будням: выходные днём в парке — не школа', () => {
    const PARK: [number, number] = [3000, -2000];
    const pts = [5, 6, 12, 13].flatMap((d) => [
      ...sit(...HOME, at(d, 0), at(d, 9)),
      ...move(HOME, PARK, at(d, 9, 10)),
      ...sit(...PARK, at(d, 10), at(d, 14), 10),
      ...move(PARK, HOME, at(d, 14, 10)),
      ...sit(...HOME, at(d, 15), at(d, 23, 59)),
    ]);
    const kinds = childPlaces(pts, TZ).map((p) => p.kind);
    expect(kinds).toContain('home');
    expect(kinds).not.toContain('school');
    expect(kinds).toContain('frequent');
  });

  it('30 дней на одном месте с точкой раз в 90 с — линейно, меньше секунды', () => {
    // Раньше центр стоянки пересчитывался по всей группе на каждой точке —
    // O(L²), на даче за месяц это сотни миллионов расстояний.
    const pts = sit(...HOME, at(0, 0), at(30, 0), 1.5);
    expect(pts.length).toBeGreaterThan(28_000);
    const t0 = Date.now();
    const places = childPlaces(pts, TZ);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(places.map((p) => p.kind)).toEqual(['home']);
  });

  it('день без точек внутри ночёвки: ночей не больше дней периода', () => {
    // Вечером дома, следующая точка — через двое суток, снова дома.
    const pts = [0, 3, 6].flatMap((d) => [
      ...sit(...HOME, at(d, 20), at(d, 23)),
      ...sit(...HOME, at(d + 2, 6), at(d + 2, 8)),
    ]);
    const [home] = childPlaces(pts, TZ);
    expect(home.kind).toBe('home');
    expect(home.daysWithData).toBe(9);
    expect(home.days).toBeLessThanOrEqual(home.daysWithData);
  });

  it('редкие ночные точки (раз в 2 часа) — всё равно дом', () => {
    const pts = [0, 1, 2, 3].flatMap((d) => sit(...HOME, at(d, 20), at(d + 1, 7), 120));
    const places = childPlaces(pts, TZ);
    expect(places[0].kind).toBe('home');
  });
});

describe('zoneVisits', () => {
  const zone = { lat: LAT0 + 2000 / M_PER_DEG, lon: pt(0, 1000, 0).lon, radius: 150 };

  it('каждый школьный день — один визит, одна точка-вылет визит не рвёт', () => {
    const pts = [0, 1, 2].flatMap((d) => weekday(d));
    // Вылет на 400 м посреди уроков первого дня.
    pts.splice(
      pts.findIndex((p) => p.t >= at(0, 10)),
      0,
      pt(SCHOOL[0] + 400, SCHOOL[1], at(0, 10) - 1),
    );
    pts.sort((a, b) => a.t - b.t);
    const v = zoneVisits(pts, zone);
    expect(v).toHaveLength(3);
    expect(v[0].from).toBe(at(0, 8, 10));
    expect(v[0].to).toBe(at(0, 13, 40));
    expect(v.every((x) => !x.ongoing)).toBe(true);

    const s = visitStats(v, TZ);
    expect(s.visits).toBe(3);
    expect(s.daysCount).toBe(3);
    expect(s.avgSec).toBe(5.5 * 3600);
    expect(s.typicalArrivalMin).toBe(8 * 60 + 10);
    expect(s.typicalDepartureMin).toBe(13 * 60 + 40);
  });

  it('незакрытый визит помечен ongoing и не входит в медиану ухода', () => {
    const pts = sit(...SCHOOL, at(0, 8), at(0, 9), 10);
    const v = zoneVisits(pts, zone);
    expect(v).toEqual([{ from: at(0, 8), to: at(0, 9), ongoing: true }]);
    expect(visitStats(v, TZ).typicalDepartureMin).toBeNull();
  });

  it('молчание дольше 12 часов делит визит', () => {
    const pts = [
      ...sit(...SCHOOL, at(0, 8), at(0, 9), 10),
      ...sit(...SCHOOL, at(1, 8), at(1, 9), 10),
    ];
    expect(zoneVisits(pts, zone)).toHaveLength(2);
  });

  it('заход короче 5 минут — не визит', () => {
    const pts = [pt(...SCHOOL, at(0, 8)), pt(...SCHOOL, at(0, 8, 3)), pt(0, 0, at(0, 8, 10))];
    expect(zoneVisits(pts, zone)).toEqual([]);
  });
});

function dist(p: { lat: number; lon: number }, [n, e]: [number, number]): number {
  const q = pt(n, e, 0);
  const dy = (p.lat - q.lat) * M_PER_DEG;
  const dx = (p.lon - q.lon) * M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
