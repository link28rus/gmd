import { UsageReportBodySchema } from '../app-control/dto/usage-report.dto';
import { clipVisits, summarizeZoneUsage, zonePeriodStart } from './zone-usage';

const MIN = 60_000;
const MIDNIGHT = Date.parse('2026-11-18T14:00:00Z');
const window = (startMs: number, segments: unknown = []) => ({ startMs, segments });

describe('Статистика использования приложений в зоне', () => {
  it('выбирает местную полночь и семь календарных дней через переход на зимнее время', () => {
    expect(zonePeriodStart(MIDNIGHT + 15 * MIN, 'Asia/Vladivostok', 1)).toBe(MIDNIGHT);
    const now = Date.parse('2026-10-26T10:00:00Z');
    expect(zonePeriodStart(now, 'Europe/Berlin', 7)).toBe(Date.parse('2026-10-19T22:00:00Z'));
  });

  it('считает только пересечение с визитом и выбранным периодом', () => {
    const visits = clipVisits(
      [{ from: MIDNIGHT - 3 * MIN, to: MIDNIGHT + 6 * MIN, ongoing: false }],
      MIDNIGHT,
      MIDNIGHT + 15 * MIN,
    );
    expect(visits).toEqual([{ from: MIDNIGHT, to: MIDNIGHT + 6 * MIN, ongoing: false }]);
    expect(
      summarizeZoneUsage(visits, [
        window(MIDNIGHT - 15 * MIN, [['video', 13 * MIN, 15 * MIN]]),
        window(MIDNIGHT, [
          ['video', 0, 2 * MIN],
          ['chat', 2 * MIN, 7 * MIN],
        ]),
      ]),
    ).toEqual({
      coverage: 'complete',
      totalSec: 360,
      apps: [
        { packageName: 'chat', seconds: 240 },
        { packageName: 'video', seconds: 120 },
      ],
    });
  });

  it('отличает пустое окно от недоставленных отчётов', () => {
    const visits = [{ from: MIDNIGHT, to: MIDNIGHT + 20 * MIN, ongoing: true }];
    expect(summarizeZoneUsage(visits, [])).toMatchObject({ coverage: 'none', totalSec: 0 });
    expect(summarizeZoneUsage(visits, [window(MIDNIGHT)])).toMatchObject({
      coverage: 'partial',
      totalSec: 0,
    });
    expect(
      summarizeZoneUsage(visits, [window(MIDNIGHT), window(MIDNIGHT + 15 * MIN)]),
    ).toMatchObject({ coverage: 'complete', totalSec: 0, apps: [] });
  });

  it('принимает старый отчёт и пустое окно, отклоняет пересечения и выход за границу', () => {
    const legacy = { timezone: 'Asia/Vladivostok', buckets: [] };
    expect(UsageReportBodySchema.safeParse(legacy).success).toBe(true);
    expect(
      UsageReportBodySchema.safeParse({ ...legacy, windows: [window(MIDNIGHT)] }).success,
    ).toBe(true);
    for (const invalid of [
      window(MIDNIGHT + 1),
      window(MIDNIGHT, [
        ['video', 0, MIN],
        ['chat', MIN - 1, 2 * MIN],
      ]),
      window(MIDNIGHT, [['video', 0, 15 * MIN + 1]]),
    ]) {
      expect(UsageReportBodySchema.safeParse({ ...legacy, windows: [invalid] }).success).toBe(
        false,
      );
    }
  });
});
