import { classifyTrack, reachableMeters } from './track-quality';
import type { QualityPoint } from './track-quality';

const OPTS = { accuracyMaxM: 50, maxSpeedMps: 70 };
// ~111 м на 0.001° широты.
const LAT0 = 48.48;
const LON0 = 135.08;

function pt(dLatM: number, tSec: number, extra: Partial<QualityPoint> = {}): QualityPoint {
  return {
    lat: LAT0 + dLatM / 111_195,
    lon: LON0,
    accuracy: 5,
    speed: null,
    t: tSec * 1000,
    flag: null,
    ...extra,
  };
}

describe('classifyTrack', () => {
  it('ровный пеший трек — все точки хорошие', () => {
    const pts = Array.from({ length: 10 }, (_, i) => pt(i * 8, i * 6, { speed: 1.4 }));
    expect(classifyTrack(pts, OPTS)).toEqual(Array(10).fill(null));
  });

  it('грубая точка — coarse', () => {
    expect(classifyTrack([pt(0, 0), pt(10, 60, { accuracy: 100 })], OPTS)).toEqual([
      null,
      'coarse',
    ]);
  });

  it('mock сохраняется как есть', () => {
    expect(classifyTrack([pt(0, 0), pt(10, 60, { flag: 'mock' })], OPTS)).toEqual([null, 'mock']);
  });

  it('телепорт с прода: 6.5 км за 15 с при speed=24 — outlier', () => {
    const pts = [pt(0, 0, { speed: 20 }), pt(6565, 15, { speed: 24 }), pt(300, 30, { speed: 20 })];
    expect(classifyTrack(pts, OPTS)).toEqual([null, 'outlier', null]);
  });

  it('доплеровская скорость строже общего порога: 494 м за 11 с при speed=0', () => {
    const pts = [pt(0, 0, { speed: 0 }), pt(494, 11, { speed: 0 }), pt(5, 60, { speed: 0 })];
    expect(classifyTrack(pts, OPTS)).toEqual([null, 'outlier', null]);
  });

  it('без скорости работает общий порог: машина 25 м/с — не outlier', () => {
    const pts = Array.from({ length: 5 }, (_, i) => pt(i * 250, i * 10));
    expect(classifyTrack(pts, OPTS)).toEqual(Array(5).fill(null));
  });

  it('не залипает на ошибочном якоре: две согласные точки подряд принимаются', () => {
    // Якорь — старый телепорт; дальше ребёнок реально в 5 км от него.
    const pts = [pt(0, 0), pt(5000, 10), pt(5010, 20), pt(5020, 30)];
    expect(classifyTrack(pts, OPTS)).toEqual([null, null, null, null]);
  });

  it('после долгого перерыва большой сдвиг — не outlier', () => {
    const pts = [pt(0, 0, { speed: 0 }), pt(8000, 600, { speed: 0 })];
    expect(classifyTrack(pts, OPTS)).toEqual([null, null]);
  });

  it('игла: отскок на 500 м и возврат за 80 с — outlier', () => {
    const pts = [pt(0, 0), pt(500, 40), pt(10, 80), pt(20, 120)];
    expect(classifyTrack(pts, OPTS)).toEqual([null, 'outlier', null, null]);
  });

  it('разворот с дорогой назад — не игла (промежуточные точки есть)', () => {
    const pts = [pt(0, 0), pt(150, 20), pt(300, 40), pt(150, 60), pt(0, 80)];
    expect(classifyTrack(pts, OPTS)).toEqual(Array(5).fill(null));
  });

  it('trustStoredPrefix: сохранённый телепорт в начале контекста не становится якорем', () => {
    const pts = [pt(9000, 0, { flag: 'outlier' }), pt(0, 10), pt(10, 20)];
    expect(classifyTrack(pts, OPTS, { trustStoredPrefix: true })).toEqual(['outlier', null, null]);
  });
});

describe('reachableMeters', () => {
  it('скорости не доверяем на длинном интервале', () => {
    const a = pt(0, 0, { speed: 0 });
    const b = pt(0, 120, { speed: 0 });
    expect(reachableMeters(a, b, OPTS)).toBeCloseTo(70 * 120 + 10);
  });
});
