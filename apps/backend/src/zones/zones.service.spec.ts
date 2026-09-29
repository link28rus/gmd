import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ZonesService, decodeEventsCursor, encodeEventsCursor } from './zones.service';
import { MAX_ZONES_PER_FAMILY } from './dto/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prismaMock: any = {
  zone: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
  zoneChildAssignment: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
  zoneState: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    upsert: jest.fn(),
  },
  zoneEvent: {
    findMany: jest.fn(),
  },
  child: { findMany: jest.fn() },
  zoneNotificationPref: { findMany: jest.fn(), upsert: jest.fn() },
  // Последние хорошие точки детей с расстоянием до центра зоны.
  $queryRaw: jest.fn(),
};
prismaMock.$transaction = jest.fn(async (fn: unknown) =>
  typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(prismaMock) : fn,
);

function zoneRow(over: Record<string, unknown> = {}) {
  return {
    id: 'z1',
    familyId: 'f1',
    name: 'X',
    color: '#22c55e',
    icon: 'home',
    centerLat: 0,
    centerLon: 0,
    radius: 100,
    allChildren: false,
    timezone: null,
    scheduleDaysMask: null,
    scheduleStartMin: null,
    scheduleEndMin: null,
    arrivalDeadlineMin: null,
    arrivalDaysMask: null,
    arrivalGraceMin: 10,
    createdBy: 'u1',
    createdAt: new Date('2026-04-20T10:00:00Z'),
    updatedAt: new Date('2026-04-20T10:00:00Z'),
    ...over,
  };
}

async function makeService(): Promise<ZonesService> {
  jest.clearAllMocks();
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.zoneNotificationPref.findMany.mockResolvedValue([]);
  const module = await Test.createTestingModule({
    providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
  }).compile();
  return module.get(ZonesService);
}

const baseInput = {
  name: 'Школа',
  color: '#22c55e' as const,
  icon: 'school' as const,
  centerLat: 48.48,
  centerLon: 135.08,
  radius: 250,
  allChildren: false,
  childIds: [] as string[],
};

describe('ZonesService.create', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    svc = await makeService();
  });

  it('создаёт зону и задаёт ZoneState по последней точке ребёнка, без события', async () => {
    prismaMock.zone.count.mockResolvedValue(3);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    // c1 стоит в 40 м от центра, у c2 точек нет.
    prismaMock.$queryRaw.mockResolvedValueOnce([{ childId: 'c1', accuracy: 15, distance_m: 40 }]);
    prismaMock.zone.create.mockResolvedValue(zoneRow({ radius: 250 }));

    const result = await svc.create('f1', 'u1', { ...baseInput, childIds: ['c1', 'c2'] });

    expect(prismaMock.zoneChildAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { zoneId: 'z1', childId: 'c1' },
        { zoneId: 'z1', childId: 'c2' },
      ],
    });
    expect(prismaMock.zoneState.createMany).toHaveBeenCalledWith({
      data: [
        { zoneId: 'z1', childId: 'c1', isInside: true },
        { zoneId: 'z1', childId: 'c2', isInside: false },
      ],
    });
    expect(result.childIds).toEqual(['c1', 'c2']);
    expect(result.states).toEqual([
      { childId: 'c1', isInside: true },
      { childId: 'c2', isInside: false },
    ]);
  });

  it('allChildren: без назначений, состояния — для всех детей семьи', async () => {
    prismaMock.zone.count.mockResolvedValue(0);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    prismaMock.zone.create.mockResolvedValue(zoneRow({ id: 'z2', allChildren: true }));

    const result = await svc.create('f1', 'u1', {
      ...baseInput,
      allChildren: true,
      childIds: ['c1'],
    });

    expect(prismaMock.zoneChildAssignment.createMany).not.toHaveBeenCalled();
    expect(prismaMock.zoneState.createMany).toHaveBeenCalledWith({
      data: [
        { zoneId: 'z2', childId: 'c1', isInside: false },
        { zoneId: 'z2', childId: 'c2', isInside: false },
      ],
    });
    expect(result.allChildren).toBe(true);
    expect(result.childIds).toEqual([]);
  });

  it('бросает ConflictException при превышении лимита', async () => {
    prismaMock.zone.count.mockResolvedValue(MAX_ZONES_PER_FAMILY);
    await expect(svc.create('f1', 'u1', baseInput)).rejects.toThrow(ConflictException);
  });

  it('бросает NotFoundException если childId не из этой семьи', async () => {
    prismaMock.zone.count.mockResolvedValue(0);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }]);
    await expect(svc.create('f1', 'u1', { ...baseInput, childIds: ['c1', 'c2'] })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ZonesService.list', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    svc = await makeService();
  });

  it('возвращает зоны семьи с assignments и states', async () => {
    prismaMock.zone.findMany.mockResolvedValue([
      {
        ...zoneRow(),
        assignments: [{ childId: 'c1' }],
        states: [{ childId: 'c1', isInside: true }],
      },
    ]);
    const result = await svc.list('f1');
    expect(result).toHaveLength(1);
    expect(result[0].childIds).toEqual(['c1']);
    expect(result[0].allChildren).toBe(false);
    expect(result[0].states).toEqual([{ childId: 'c1', isInside: true }]);
  });
});

describe('ZonesService.get', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    svc = await makeService();
  });

  it('бросает NotFoundException для чужой семьи (anti-enumeration)', async () => {
    prismaMock.zone.findFirst.mockResolvedValue(null);
    await expect(svc.get('f2', 'z1')).rejects.toThrow(NotFoundException);
  });
});

describe('ZonesService.update', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    svc = await makeService();
  });

  it('синхронизирует назначения; состояние создаётся только новому ребёнку', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({
      ...zoneRow(),
      deletedAt: null,
      assignments: [{ childId: 'c1' }, { childId: 'c2' }],
      states: [
        { childId: 'c1', isInside: false },
        { childId: 'c2', isInside: true },
      ],
    });
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c3' }]);
    prismaMock.zone.findUniqueOrThrow.mockResolvedValue({
      ...zoneRow(),
      assignments: [{ childId: 'c2' }, { childId: 'c3' }],
      states: [
        { childId: 'c2', isInside: true },
        { childId: 'c3', isInside: false },
      ],
    });

    await svc.update('f1', 'z1', { childIds: ['c2', 'c3'] });

    expect(prismaMock.zoneChildAssignment.deleteMany).toHaveBeenCalledWith({
      where: { zoneId: 'z1', childId: { in: ['c1'] } },
    });
    expect(prismaMock.zoneState.deleteMany).toHaveBeenCalledWith({
      where: { zoneId: 'z1', childId: { notIn: ['c2', 'c3'] } },
    });
    expect(prismaMock.zoneChildAssignment.createMany).toHaveBeenCalledWith({
      data: [{ zoneId: 'z1', childId: 'c3' }],
    });
    expect(prismaMock.zoneState.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.zoneState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { zoneId: 'z1', childId: 'c3', isInside: false } }),
    );
  });

  it('смена радиуса пересчитывает состояние без события и сбрасывает ожидание', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({
      ...zoneRow(),
      deletedAt: null,
      assignments: [{ childId: 'c1' }],
      states: [{ childId: 'c1', isInside: false }],
    });
    prismaMock.$queryRaw.mockResolvedValueOnce([{ childId: 'c1', accuracy: 10, distance_m: 180 }]);
    prismaMock.zone.findUniqueOrThrow.mockResolvedValue({
      ...zoneRow({ radius: 300 }),
      assignments: [{ childId: 'c1' }],
      states: [{ childId: 'c1', isInside: true }],
    });

    await svc.update('f1', 'z1', { radius: 300 });

    expect(prismaMock.zoneState.upsert).toHaveBeenCalledWith({
      where: { zoneId_childId: { zoneId: 'z1', childId: 'c1' } },
      create: { zoneId: 'z1', childId: 'c1', isInside: true },
      update: {
        isInside: true,
        pendingTransition: false,
        pendingSince: null,
        lastConfirmedChange: null,
      },
    });
  });

  it('включение allChildren удаляет явные назначения', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({
      ...zoneRow(),
      deletedAt: null,
      assignments: [{ childId: 'c1' }],
      states: [{ childId: 'c1', isInside: false }],
    });
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    prismaMock.zone.findUniqueOrThrow.mockResolvedValue({
      ...zoneRow({ allChildren: true }),
      assignments: [],
      states: [],
    });

    await svc.update('f1', 'z1', { allChildren: true });

    expect(prismaMock.zoneChildAssignment.deleteMany).toHaveBeenCalledWith({
      where: { zoneId: 'z1', childId: { in: ['c1'] } },
    });
    // c1 уже имел состояние — пересчёт только для нового c2.
    expect(prismaMock.zoneState.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.zone.update).toHaveBeenCalledWith({
      where: { id: 'z1' },
      data: { allChildren: true },
    });
  });
});

describe('ZonesService.softDelete', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    svc = await makeService();
  });

  it('устанавливает deletedAt и не трогает события/состояния', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({ id: 'z1', familyId: 'f1', deletedAt: null });
    prismaMock.zone.update.mockResolvedValue({ id: 'z1', deletedAt: new Date() });

    await svc.softDelete('f1', 'z1');

    expect(prismaMock.zone.update).toHaveBeenCalledWith({
      where: { id: 'z1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(prismaMock.zoneState.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ZonesService.listEvents', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    svc = await makeService();
  });

  it('возвращает события семьи с длительностью у выхода', async () => {
    prismaMock.zoneEvent.findMany.mockResolvedValue([
      {
        id: 'e1',
        zoneId: 'z1',
        childId: 'c1',
        type: 'exit',
        lat: 48,
        lon: 135,
        accuracy: 10,
        durationSec: 5400,
        recordedAt: new Date('2026-04-20T10:00:00Z'),
        createdAt: new Date('2026-04-20T10:00:05Z'),
        zone: { name: 'Школа', color: '#22c55e', icon: 'school' },
        child: { name: 'Аня' },
      },
    ]);

    const result = await svc.listEvents('f1', { limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].zoneName).toBe('Школа');
    expect(result.items[0].durationSec).toBe(5400);
    expect(result.nextCursor).toBeNull();
  });

  it('полная страница отдаёт курсор по последнему событию', async () => {
    const at = new Date('2026-04-20T10:00:00Z');
    prismaMock.zoneEvent.findMany.mockResolvedValue([
      {
        id: 'e9',
        zoneId: 'z1',
        childId: 'c1',
        type: 'entry',
        lat: 0,
        lon: 0,
        accuracy: null,
        durationSec: null,
        recordedAt: at,
        createdAt: at,
        zone: { name: 'Школа', color: '#22c55e', icon: 'school' },
        child: { name: 'Аня' },
      },
    ]);
    const result = await svc.listEvents('f1', { limit: 1 });
    expect(result.nextCursor).not.toBeNull();
    expect(decodeEventsCursor(result.nextCursor as string)).toEqual({ recordedAt: at, id: 'e9' });
  });

  it('курсор — пара (recordedAt, id), фильтр строго после неё', async () => {
    const at = new Date('2026-04-20T10:00:00Z');
    prismaMock.zoneEvent.findMany.mockResolvedValue([]);
    await svc.listEvents('f1', { limit: 50, cursor: encodeEventsCursor(at, 'e5') });
    const args = prismaMock.zoneEvent.findMany.mock.calls[0][0];
    expect(args.where.AND).toContainEqual({
      OR: [{ recordedAt: { lt: at } }, { recordedAt: at, id: { lt: 'e5' } }],
    });
    expect(args.orderBy).toEqual([{ recordedAt: 'desc' }, { id: 'desc' }]);
  });

  it('битый курсор — BadRequest', () => {
    expect(() => decodeEventsCursor('не курсор')).toThrow();
    expect(() => decodeEventsCursor(Buffer.from('[1,2]').toString('base64url'))).toThrow();
  });
});

describe('ZonesService — расписание, срок, личные настройки (v0.65.0)', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    svc = await makeService();
    prismaMock.zone.count.mockResolvedValue(0);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }]);
  });

  it('срок без пояса — 400 timezone_required', async () => {
    await expect(
      svc.create('f1', 'u1', {
        ...baseInput,
        childIds: ['c1'],
        arrival: { deadlineMin: 510, daysMask: 31, graceMin: 10 },
      }),
    ).rejects.toMatchObject({ response: { code: 'timezone_required' } });
  });

  it('неизвестный пояс — 400 invalid_timezone', async () => {
    await expect(
      svc.create('f1', 'u1', { ...baseInput, childIds: ['c1'], timezone: 'Mars/Olympus' }),
    ).rejects.toMatchObject({ response: { code: 'invalid_timezone' } });
  });

  it('create пишет колонки расписания и срока и отдаёт myPrefs по умолчанию', async () => {
    prismaMock.zone.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      zoneRow({ ...data, id: 'z9' }),
    );
    const res = await svc.create('f1', 'u1', {
      ...baseInput,
      childIds: ['c1'],
      timezone: 'Asia/Vladivostok',
      schedule: { daysMask: 31, startMin: 480, endMin: 900 },
      arrival: { deadlineMin: 510, daysMask: 31, graceMin: 15 },
    });
    expect(prismaMock.zone.create.mock.calls[0][0].data).toMatchObject({
      timezone: 'Asia/Vladivostok',
      scheduleDaysMask: 31,
      scheduleStartMin: 480,
      scheduleEndMin: 900,
      arrivalDeadlineMin: 510,
      arrivalDaysMask: 31,
      arrivalGraceMin: 15,
    });
    expect(res.schedule).toEqual({ daysMask: 31, startMin: 480, endMin: 900 });
    expect(res.arrival).toEqual({ deadlineMin: 510, daysMask: 31, graceMin: 15 });
    expect(res.myPrefs).toEqual([
      { childId: 'c1', onEntry: true, onExit: true, onMissedArrival: true },
    ]);
  });

  it('setMyNotifications: ребёнок не из зоны — 404', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({
      ...zoneRow(),
      assignments: [{ childId: 'c1' }],
      states: [],
    });
    await expect(
      svc.setMyNotifications('f1', 'u1', 'z1', {
        items: [
          {
            childId: 'c2xxxxxxxxxxxxxxxxxxxxxx',
            onEntry: false,
            onExit: true,
            onMissedArrival: true,
          },
        ],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
