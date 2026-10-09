import {
  TRACK_GAP_MIN_DIST_M,
  TRACK_GAP_MIN_MS,
  formatGapLabel,
  haversineMeters,
  pathMidpoint,
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

/** v0.80.0: достроенная по дороге точка (время интерполировано сервером). */
function inf(min: number, dLat = 0): TrackPoint {
  return { ...pt(min, dLat), inferred: true };
}

describe('splitTrackByGaps', () => {
  it('пустой массив → нет сегментов и разрывов', () => {
    expect(splitTrackByGaps([])).toEqual({ segments: [], gaps: [], inferred: [] });
  });

  it('одна точка → один сегмент из одной точки', () => {
    const p = pt(0);
    expect(splitTrackByGaps([p])).toEqual({ segments: [[p]], gaps: [], inferred: [] });
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

  it('inferred: false — обычная точка', () => {
    const points = [pt(0), { ...pt(1, 0.001), inferred: false }, pt(2, 0.002)];
    expect(splitTrackByGaps(points)).toEqual({ segments: [points], gaps: [], inferred: [] });
  });
});

describe('splitTrackByGaps: достроенные участки (v0.80.0)', () => {
  it('серия достроенных точек — отдельный участок от реальной до реальной', () => {
    const a = pt(0);
    const b = pt(1, 0.001);
    // 40 мин без данных, сервер достроил путь по дороге (~2 км).
    const i1 = inf(11, 0.006);
    const i2 = inf(21, 0.011);
    const i3 = inf(31, 0.016);
    const c = pt(41, 0.02);
    const d = pt(42, 0.021);
    const { segments, gaps, inferred } = splitTrackByGaps([a, b, i1, i2, i3, c, d]);
    expect(segments).toEqual([
      [a, b],
      [c, d],
    ]);
    // Обычного разрыва нет — ни серого пунктира, ни двойной подписи.
    expect(gaps).toEqual([]);
    expect(inferred).toEqual([
      { points: [b, i1, i2, i3, c], from: b, to: c, durationMs: 40 * 60_000 },
    ]);
  });

  it('между достроенными точками разрыв не ищем (времена интерполированы)', () => {
    // Между i1 и i2 «прошло» 30 мин и ~1 км — для реальных точек это разрыв.
    const a = pt(0);
    const i1 = inf(1, 0.001);
    const i2 = inf(31, 0.01);
    const b = pt(32, 0.011);
    const { gaps, inferred } = splitTrackByGaps([a, i1, i2, b]);
    expect(gaps).toEqual([]);
    expect(inferred).toHaveLength(1);
    expect(inferred[0].points).toEqual([a, i1, i2, b]);
  });

  it('реальная точка между двумя сериями — одиночный сегмент, две серии', () => {
    const a = pt(0);
    const i1 = inf(10, 0.005);
    const mid = pt(20, 0.01);
    const i2 = inf(30, 0.015);
    const b = pt(40, 0.02);
    const { segments, inferred } = splitTrackByGaps([a, i1, mid, i2, b]);
    expect(segments).toEqual([[a], [mid], [b]]);
    expect(inferred.map((r) => r.points)).toEqual([
      [a, i1, mid],
      [mid, i2, b],
    ]);
    expect(inferred.map((r) => r.durationMs)).toEqual([20 * 60_000, 20 * 60_000]);
  });

  it('достройка на краях трека — участок без реальной точки с той стороны', () => {
    const i1 = inf(0, 0);
    const a = pt(10, 0.005);
    const b = pt(11, 0.006);
    const i2 = inf(20, 0.01);
    const { segments, inferred } = splitTrackByGaps([i1, a, b, i2]);
    expect(segments).toEqual([[a, b]]);
    expect(inferred.map((r) => r.points)).toEqual([
      [i1, a],
      [b, i2],
    ]);
  });

  it('обычный разрыв и достройка в одном треке', () => {
    const a = pt(0);
    const b = pt(1, 0.001);
    const c = pt(68, 0.02); // 67 мин, ~2 км — разрыв без достройки
    const i1 = inf(80, 0.03);
    const d = pt(90, 0.04);
    const { segments, gaps, inferred } = splitTrackByGaps([a, b, c, i1, d]);
    expect(segments).toEqual([[a, b], [c], [d]]);
    expect(gaps).toEqual([{ from: b, to: c, durationMs: 67 * 60_000 }]);
    expect(inferred).toEqual([{ points: [c, i1, d], from: c, to: d, durationMs: 22 * 60_000 }]);
  });

  it('единственная достроенная точка без соседей — участка нет', () => {
    expect(splitTrackByGaps([inf(0)])).toEqual({ segments: [], gaps: [], inferred: [] });
  });
});

describe('pathMidpoint', () => {
  it('пусто → null, одна точка → она сама', () => {
    expect(pathMidpoint([])).toBeNull();
    expect(pathMidpoint([pt(0)])).toEqual({ lat: BASE_LAT, lon: BASE_LON });
  });

  it('середина по длине ломаной, а не по числу точек', () => {
    // 0 → 0.001 (≈111 м) → 0.011 (≈1.1 км): середина на втором отрезке.
    const mid = pathMidpoint([pt(0), pt(1, 0.001), pt(2, 0.011)]);
    expect(mid?.lat).toBeCloseTo(BASE_LAT + 0.0055, 6);
    expect(mid?.lon).toBeCloseTo(BASE_LON, 6);
  });

  it('все точки в одном месте — первая точка', () => {
    expect(pathMidpoint([pt(0), pt(1), pt(2)])).toEqual({ lat: BASE_LAT, lon: BASE_LON });
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
