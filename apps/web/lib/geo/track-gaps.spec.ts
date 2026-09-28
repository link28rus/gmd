import {
  TRACK_GAP_MIN_DIST_M,
  TRACK_GAP_MIN_MS,
  formatGapLabel,
  haversineMeters,
  splitTrackByGaps,
  type TrackPoint,
} from './track-gaps';

// 0.001° широты ≈ 111 м, 0.01° ≈ 1.1 км — удобно для порогов 300 м.
const BASE_LAT = 55.75;
const BASE_LON = 37.61;
const T0 = Date.parse('2026-09-28T08:00:00.000Z');

/** Точка через `min` минут от T0, сдвинутая на `dLat` градусов к северу. */
function pt(min: number, dLat = 0): TrackPoint {
  return {
    lat: BASE_LAT + dLat,
    lon: BASE_LON,
    recordedAt: new Date(T0 + min * 60_000).toISOString(),
  };
}

describe('splitTrackByGaps', () => {
  it('пустой массив → нет сегментов и разрывов', () => {
    expect(splitTrackByGaps([])).toEqual({ segments: [], gaps: [] });
  });

  it('одна точка → один сегмент из одной точки', () => {
    const p = pt(0);
    expect(splitTrackByGaps([p])).toEqual({ segments: [[p]], gaps: [] });
  });

  it('без разрывов — один сегмент со всеми точками', () => {
    const points = [pt(0), pt(1, 0.001), pt(2, 0.002), pt(3, 0.003)];
    const { segments, gaps } = splitTrackByGaps(points);
    expect(segments).toEqual([points]);
    expect(gaps).toEqual([]);
  });

  it('> 5 мин и > 300 м — разрыв', () => {
    const a = pt(0);
    const b = pt(1, 0.001);
    const c = pt(68, 0.02); // 67 мин тишины, ~2 км
    const d = pt(69, 0.021);
    const { segments, gaps } = splitTrackByGaps([a, b, c, d]);
    expect(segments).toEqual([
      [a, b],
      [c, d],
    ]);
    expect(gaps).toEqual([{ from: b, to: c, durationMs: 67 * 60_000 }]);
  });

  it('долго стоял на месте (> 5 мин, < 300 м) — НЕ разрыв', () => {
    const points = [pt(0), pt(40, 0.001), pt(41, 0.002)]; // 40 мин, ~111 м
    const { segments, gaps } = splitTrackByGaps(points);
    expect(segments).toEqual([points]);
    expect(gaps).toEqual([]);
  });

  it('быстро и далеко (< 5 мин, > 300 м) — НЕ разрыв', () => {
    const points = [pt(0), pt(2, 0.01), pt(3, 0.02)]; // 2 мин, ~1.1 км
    const { segments, gaps } = splitTrackByGaps(points);
    expect(segments).toEqual([points]);
    expect(gaps).toEqual([]);
  });

  it('ровно 5 мин — ещё не разрыв (строго больше)', () => {
    const points = [pt(0), pt(5, 0.01)];
    expect(splitTrackByGaps(points).gaps).toEqual([]);
  });

  it('несколько разрывов + одиночная точка между ними не теряется', () => {
    const a = pt(0);
    const b = pt(1, 0.001);
    const lone = pt(20, 0.02); // разрыв 1: 19 мин, ~2 км
    const c = pt(90, 0.05); // разрыв 2: 70 мин, ~3 км
    const d = pt(91, 0.051);
    const { segments, gaps } = splitTrackByGaps([a, b, lone, c, d]);
    expect(segments).toEqual([[a, b], [lone], [c, d]]);
    expect(gaps).toEqual([
      { from: b, to: lone, durationMs: 19 * 60_000 },
      { from: lone, to: c, durationMs: 70 * 60_000 },
    ]);
    // Все точки на месте: сегменты покрывают вход без потерь и дублей.
    expect(segments.flat()).toEqual([a, b, lone, c, d]);
  });

  it('битая дата не режет трек', () => {
    const points = [pt(0), { ...pt(60, 0.02), recordedAt: 'not-a-date' }];
    expect(splitTrackByGaps(points).gaps).toEqual([]);
  });
});

describe('haversineMeters', () => {
  it('0.001° широты ≈ 111 м', () => {
    expect(haversineMeters(pt(0), pt(0, 0.001))).toBeCloseTo(111.2, 0);
  });

  it('пороги контракта', () => {
    expect(TRACK_GAP_MIN_MS).toBe(300_000);
    expect(TRACK_GAP_MIN_DIST_M).toBe(300);
  });
});

describe('formatGapLabel', () => {
  it.each([
    [6 * 60_000, 'нет данных 6 мин'],
    [59 * 60_000, 'нет данных 59 мин'],
    [60 * 60_000, 'нет данных 1 ч'],
    [67 * 60_000, 'нет данных 1 ч 7 мин'],
    [120 * 60_000, 'нет данных 2 ч'],
    [(125 * 60 + 29) * 1000, 'нет данных 2 ч 5 мин'],
    [(5 * 60 + 40) * 1000, 'нет данных 5 мин'], // вниз, как в приложении родителя
  ])('%i мс → %s', (ms, label) => {
    expect(formatGapLabel(ms)).toBe(label);
  });
});
