import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ListTripsQuerySchema } from './dto/list-trips.dto';
import { TripsService, matchTrips } from './trips.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MIN = 60_000;

interface Pt {
  lat: number;
  lon: number;
  recordedAt: Date;
  accuracy: number | null;
}

// Стоянка в A 40 мин → переезд ~2 км за 10 мин → стоянка в B `stayBMin` минут.
function tripPoints(t0: number, stayBMin: number): Pt[] {
  const out: Pt[] = [];
  let t = t0;
  const push = (lat: number, lon: number): void => {
    out.push({ lat, lon, recordedAt: new Date(t), accuracy: 10 });
    t += MIN;
  };
  for (let i = 0; i < 40; i++) push(55.0, 37.0);
  for (let i = 1; i <= 10; i++) push(55.0 + 0.002 * i, 37.0);
  for (let i = 0; i < stayBMin; i++) push(55.02, 37.0);
  return out;
}

function makeService(state: { points: Pt[]; allPoints?: Pt[] }) {
  const trips: any[] = [];
  let seq = 0;
  const filterPoints = (where: any): Pt[] =>
    state.points.filter(
      (p) =>
        p.recordedAt >= where.recordedAt.gte &&
        (!where.recordedAt.lte || p.recordedAt <= where.recordedAt.lte),
    );
  const location = {
    findMany: jest.fn().mockImplementation(async (args: any) => {
      const rows = filterPoints(args.where).sort(
        (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
      );
      if (args.orderBy.recordedAt === 'desc') rows.reverse();
      return args.take ? rows.slice(0, args.take) : rows;
    }),
    aggregate: jest.fn().mockImplementation(async (args: any) => {
      const rows = filterPoints(args.where);
      const max = rows.reduce<Date | null>(
        (m, p) => (!m || p.recordedAt > m ? p.recordedAt : m),
        null,
      );
      return { _count: { _all: rows.length }, _max: { recordedAt: max } };
    }),
    findFirst: jest.fn().mockImplementation(async (args: any) => {
      const src = state.allPoints ?? state.points;
      const rows = src
        .filter((p) => !args.where.recordedAt || p.recordedAt >= args.where.recordedAt.gte)
        .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
      return rows[0] ? { recordedAt: rows[0].recordedAt } : null;
    }),
  };
  const trip = {
    findMany: jest.fn().mockImplementation(async (args: any) =>
      trips
        .filter((t) => t.childId === args.where.childId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .map((t) => ({ ...t })),
    ),
    findUnique: jest
      .fn()
      .mockImplementation(async (args: any) => trips.find((t) => t.id === args.where.id) ?? null),
    deleteMany: jest.fn().mockImplementation(async (args: any) => {
      const ids: string[] = args.where.id.in;
      for (let i = trips.length - 1; i >= 0; i--) if (ids.includes(trips[i].id)) trips.splice(i, 1);
      return { count: ids.length };
    }),
    update: jest.fn().mockImplementation(async (args: any) => {
      const t = trips.find((x) => x.id === args.where.id);
      Object.assign(t, args.data);
      return t;
    }),
    createMany: jest.fn().mockImplementation(async (args: any) => {
      for (const d of args.data) trips.push({ id: `trip-${++seq}`, ...d });
      return { count: args.data.length };
    }),
  };
  const tx = { location, trip, $queryRaw: jest.fn().mockResolvedValue([]) };
  const prisma: any = {
    location,
    trip,
    $transaction: jest.fn().mockImplementation((cb: (t: any) => Promise<unknown>) => cb(tx)),
  };
  const settings: any = {
    getNumber: jest.fn().mockImplementation((_k: string, fallback: number) => fallback),
  };
  const road: any = { enabled: () => false, snap: jest.fn().mockResolvedValue(null) };
  const svc = new TripsService(prisma, settings, road);
  return { svc, trips, prisma, tx };
}

describe('matchTrips', () => {
  const d = (ms: number): Date => new Date(ms);

  it('keeps id on exact startedAt even when end moved', () => {
    const ids = matchTrips(
      [{ id: 'a', startedAt: d(1000), endedAt: null }],
      [{ startedAt: 1000, endedAt: 5000 }],
      9000,
    );
    expect(ids).toEqual(['a']);
  });

  it('matches shifted start by overlap, nearest start first, one-to-one', () => {
    const ids = matchTrips(
      [
        { id: 'a', startedAt: d(1000), endedAt: d(3000) },
        { id: 'b', startedAt: d(6000), endedAt: d(8000) },
      ],
      [
        { startedAt: 1200, endedAt: 3000 }, // a, начало сдвинулось
        { startedAt: 2500, endedAt: 7000 }, // пересекает обе, a уже занята → b
        { startedAt: 20_000, endedAt: 21_000 }, // новая
      ],
      30_000,
    );
    expect(ids).toEqual(['a', 'b', undefined]);
  });

  it('active stored trip spans till now, exact match wins over overlap', () => {
    const ids = matchTrips(
      [{ id: 'a', startedAt: d(1000), endedAt: null }],
      [
        { startedAt: 5000, endedAt: 6000 },
        { startedAt: 1000, endedAt: 3000 },
      ],
      10_000,
    );
    expect(ids).toEqual([undefined, 'a']);
  });
});

describe('TripsService.recomputeForChild', () => {
  it('keeps trip id across recomputes and takes the per-child advisory lock', async () => {
    const t0 = Date.now() - 3 * 60 * MIN;
    const state = { points: tripPoints(t0, 35) };
    const { svc, trips, tx } = makeService(state);

    await svc.recomputeForChild('c1');
    expect(trips).toHaveLength(1);
    const id = trips[0].id;
    const startedAt = trips[0].startedAt.getTime();

    // Стоянка в B продолжается — новые точки в хвосте.
    state.points = tripPoints(t0, 60);
    await svc.recomputeForChild('c1');
    expect(trips).toHaveLength(1);
    expect(trips[0].id).toBe(id);
    expect(trips[0].startedAt.getTime()).toBe(startedAt);
    expect(tx.trip.createMany).toHaveBeenCalledTimes(1);

    const lockSql = tx.$queryRaw.mock.calls[0][0];
    expect(lockSql.sql).toContain('pg_advisory_xact_lock');
    expect(lockSql.values).toEqual(['c1']);
  });

  it('does not touch an unchanged trip', async () => {
    const t0 = Date.now() - 3 * 60 * MIN;
    const { svc, tx } = makeService({ points: tripPoints(t0, 35) });
    await svc.recomputeForChild('c1');
    await svc.recomputeForChild('c1');
    expect(tx.trip.update).not.toHaveBeenCalled();
    expect(tx.trip.deleteMany).not.toHaveBeenCalled();
  });

  it('re-reads points under the lock when they changed after the first read', async () => {
    const t0 = Date.now() - 3 * 60 * MIN;
    const state = { points: tripPoints(t0, 35) };
    const { svc, tx, trips } = makeService(state);
    const later = tripPoints(t0, 60);
    // Между первым чтением и локом пришла параллельная выгрузка.
    tx.location.aggregate.mockImplementationOnce(async () => {
      state.points = later;
      return {
        _count: { _all: later.length },
        _max: { recordedAt: later[later.length - 1].recordedAt },
      };
    });
    await svc.recomputeForChild('c1');
    expect(tx.location.findMany).toHaveBeenCalledTimes(2);
    expect(trips).toHaveLength(1);
  });

  it('deletes trips that disappeared', async () => {
    const t0 = Date.now() - 3 * 60 * MIN;
    const state = { points: tripPoints(t0, 35) };
    const { svc, trips } = makeService(state);
    await svc.recomputeForChild('c1');
    expect(trips).toHaveLength(1);
    state.points = [];
    await svc.recomputeForChild('c1');
    expect(trips).toHaveLength(0);
  });
});

describe('TripsService.getTripTrack', () => {
  it('404 for a missing trip', async () => {
    const { svc } = makeService({ points: [] });
    await expect(svc.getTripTrack('c1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("404 for another child's trip", async () => {
    const t0 = Date.now() - 3 * 60 * MIN;
    const { svc, trips } = makeService({ points: tripPoints(t0, 35) });
    await svc.recomputeForChild('c1');
    await expect(svc.getTripTrack('c2', trips[0].id, 'recorded')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const ok = await svc.getTripTrack('c1', trips[0].id, 'recorded');
    expect(ok.points.length).toBeGreaterThan(0);
  });
});

describe('TripsService.listTrips isActive', () => {
  function seedActive(lastAgoMin: number) {
    const now = Date.now();
    const pts: Pt[] = [
      { lat: 55, lon: 37, recordedAt: new Date(now - 60 * MIN), accuracy: 10 },
      { lat: 55.01, lon: 37, recordedAt: new Date(now - lastAgoMin * MIN), accuracy: 10 },
    ];
    const ctx = makeService({ points: pts });
    ctx.trips.push({
      id: 't1',
      childId: 'c1',
      startedAt: new Date(now - 60 * MIN),
      endedAt: null,
      isActive: true,
      pointsCount: 2,
      distanceM: 1100,
      roadMatched: false,
      startLat: 55,
      startLon: 37,
      endLat: 55.01,
      endLon: 37,
    });
    return { ...ctx, last: pts[1].recordedAt };
  }

  it('stale active trip is returned closed at its last point', async () => {
    const { svc, last } = seedActive(45); // порог по умолчанию 30 мин
    const [t] = await svc.listTrips('c1');
    expect(t.isActive).toBe(false);
    expect(t.endedAt).toBe(last.toISOString());
  });

  it('fresh active trip stays active', async () => {
    const { svc } = seedActive(2);
    const [t] = await svc.listTrips('c1');
    expect(t.isActive).toBe(true);
    expect(t.endedAt).toBeNull();
  });
});

describe('TripsService track trimming', () => {
  it('keeps the newest points and returns them in time order', async () => {
    const now = Date.now();
    const pts: Pt[] = [];
    for (let i = 0; i < 6000; i++) {
      pts.push({
        lat: 55 + i * 0.0005,
        lon: 37,
        recordedAt: new Date(now - (6000 - i) * 10_000),
        accuracy: 5,
      });
    }
    const { svc } = makeService({ points: pts });
    const res = await svc.getTrack(
      'c1',
      new Date(now - 2 * 24 * 60 * MIN),
      new Date(now),
      'recorded',
    );
    const times = res.points.map((p) => Date.parse(p.recordedAt));
    expect(times[times.length - 1]).toBe(pts[pts.length - 1].recordedAt.getTime());
    expect(times[0]).toBe(pts[1000].recordedAt.getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });
});

describe('ListTripsQuerySchema', () => {
  const pipe = new ZodValidationPipe(ListTripsQuerySchema);

  it('400 on a malformed date', () => {
    expect(() => pipe.transform({ from: 'abc' })).toThrow(BadRequestException);
    try {
      pipe.transform({ to: 'abc' });
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'bad_request' });
    }
  });

  it('accepts what web and mobile-parent send', () => {
    expect(pipe.transform({})).toEqual({});
    expect(pipe.transform({ from: '2026-10-12T10:00:00.123456Z' })).toBeTruthy(); // Dart toUtc()
    expect(
      pipe.transform({ from: '2026-10-12T10:00:00.000Z', to: '2026-10-12T13:00:00+03:00' }),
    ).toBeTruthy();
  });
});
