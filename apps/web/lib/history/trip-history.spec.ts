import type { TripDto } from '@/lib/api/locations';
import type { Zone } from '@/lib/api/zones';
import {
  avgSpeedKmh,
  dayTitle,
  fmtDistance,
  fmtDurationMs,
  groupTripsByDay,
  pluralRu,
  ribbonSpan,
  TRIP_COLORS,
  zoneAt,
} from './trip-history';

function trip(id: string, start: Date, end: Date | null, distanceM = 1000): TripDto {
  return {
    id,
    startedAt: start.toISOString(),
    endedAt: end ? end.toISOString() : null,
    isActive: end === null,
    pointsCount: 10,
    distanceM,
    startLat: 50,
    startLon: 127,
    endLat: 50.01,
    endLon: 127.01,
  };
}

const at = (d: number, h: number, m = 0): Date => new Date(2026, 9, d, h, m);

describe('groupTripsByDay', () => {
  it('новые дни сверху, внутри дня — по времени, номера и цвета по порядку', () => {
    const days = groupTripsByDay(
      [
        trip('b', at(9, 12, 35), at(9, 12, 48), 918),
        trip('old', at(8, 8, 10), at(8, 8, 24)),
        trip('a', at(9, 8, 13), at(9, 8, 23), 1300),
      ],
      at(9, 20).getTime(),
    );
    expect(days.map((d) => d.key)).toEqual(['2026-10-09', '2026-10-08']);
    expect(days[0].trips.map((t) => [t.trip.id, t.ordinal, t.color])).toEqual([
      ['a', 1, TRIP_COLORS[0]],
      ['b', 2, TRIP_COLORS[1]],
    ]);
    expect(days[0].distanceM).toBe(2218);
    expect(days[0].movingMs).toBe(23 * 60_000);
  });

  it('поездка через полночь — в дне старта; идущая считается до «сейчас»', () => {
    const days = groupTripsByDay(
      [trip('night', at(8, 23, 50), at(9, 0, 20)), trip('live', at(9, 10), null)],
      at(9, 10, 30).getTime(),
    );
    expect(days.find((d) => d.key === '2026-10-08')?.trips[0].trip.id).toBe('night');
    expect(days.find((d) => d.key === '2026-10-09')?.movingMs).toBe(30 * 60_000);
  });
});

describe('ribbonSpan', () => {
  it('доли суток и обрезка по полуночи', () => {
    const s = ribbonSpan(trip('x', at(9, 6), at(9, 12)), at(9, 0));
    expect(s.left).toBeCloseTo(0.25);
    expect(s.width).toBeCloseTo(0.25);
    const night = ribbonSpan(trip('n', at(9, 23), at(10, 1)), at(9, 0));
    expect(night.left + night.width).toBeCloseTo(1);
  });
});

describe('подписи', () => {
  it('dayTitle', () => {
    const now = at(9, 15);
    expect(dayTitle(at(9, 0), now)).toEqual({ title: 'Сегодня', date: '9 октября' });
    expect(dayTitle(at(8, 0), now).title).toBe('Вчера');
    expect(dayTitle(at(5, 0), now)).toEqual({ title: 'Понедельник', date: '5 октября' });
    expect(dayTitle(new Date(2025, 11, 31), now).date).toBe('31 декабря 2025');
  });

  it('расстояние, длительность, скорость, склонение', () => {
    expect(fmtDistance(918)).toBe('918 м');
    expect(fmtDistance(1300)).toBe('1,3 км');
    expect(fmtDistance(109_100)).toBe('109 км');
    expect(fmtDurationMs(14 * 60_000)).toBe('14 мин');
    expect(fmtDurationMs(101 * 60_000)).toBe('1 ч 41 мин');
    expect(fmtDurationMs(10_000)).toBe('1 мин');
    expect(avgSpeedKmh(13_400, 35 * 60_000)).toBe(23);
    expect(avgSpeedKmh(10, 60_000)).toBeNull();
    expect([1, 2, 5, 11, 21, 22].map((n) => pluralRu(n, 'п', 'пп', 'ппп'))).toEqual([
      'п',
      'пп',
      'ппп',
      'ппп',
      'п',
      'пп',
    ]);
  });
});

describe('zoneAt', () => {
  const zone = (id: string, lat: number, lon: number, radius: number): Zone =>
    ({ id, name: id, centerLat: lat, centerLon: lon, radius }) as Zone;

  it('точка в зоне с запасом; из вложенных — меньшая', () => {
    const zones = [zone('район', 50, 127, 2000), zone('школа', 50.001, 127, 150)];
    expect(zoneAt(zones, 50.001, 127)?.id).toBe('школа');
    expect(zoneAt(zones, 50.01, 127)?.id).toBe('район');
    expect(zoneAt(zones, 51, 127)).toBeNull();
    // 150 м радиус + 30 м запас: точка в ~170 м ещё внутри
    expect(zoneAt([zone('школа', 50, 127, 150)], 50.00153, 127)?.id).toBe('школа');
  });
});
