import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { ParentDevicesService } from '../parent-devices/parent-devices.service';
import { ZoneDetectionService } from './zone-detection.service';

const prismaMock = {
  $queryRaw: jest.fn(),
  zoneState: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
  zoneEvent: { create: jest.fn() },
};

describe('ZoneDetectionService.findCandidateZones', () => {
  let svc: ZoneDetectionService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ZoneDetectionService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: FcmService,
          useValue: {
            sendToToken: jest.fn().mockResolvedValue(true),
            sendHybridToToken: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: ParentDevicesService,
          useValue: {
            findActiveByFamilyId: jest.fn().mockResolvedValue([]),
            clearTokenByExpired: jest.fn().mockResolvedValue(undefined),
            clearRustoreByExpired: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    svc = module.get(ZoneDetectionService);
  });

  it('вызывает ST_DWithin с buffer = max(30, radius*0.15) и фильтрует по assignment+family', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 200 }]);
    const result = await svc.findCandidateZones(prismaMock as never, 'f1', 'c1', 48.48, 135.08);
    expect(result).toEqual([{ id: 'z1', radius: 250, distanceM: 200 }]);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('ZoneDetectionService.processPoint', () => {
  let svc: ZoneDetectionService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ZoneDetectionService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: FcmService,
          useValue: {
            sendToToken: jest.fn().mockResolvedValue(true),
            sendHybridToToken: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: ParentDevicesService,
          useValue: {
            findActiveByFamilyId: jest.fn().mockResolvedValue([]),
            clearTokenByExpired: jest.fn().mockResolvedValue(undefined),
            clearRustoreByExpired: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    svc = module.get(ZoneDetectionService);
  });

  const basePoint = {
    familyId: 'f1',
    childId: 'c1',
    deviceId: 'd1',
    lat: 48.48,
    lon: 135.08,
    accuracy: 10,
    recordedAt: new Date('2026-04-20T10:00:00Z'),
  };

  it('первая точка внутри зоны — стартует pendingTransition, события не создаёт', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 100 }]);
    prismaMock.zoneState.findMany.mockResolvedValue([]); // no existing state
    await svc.processPoint(prismaMock as never, basePoint);
    expect(prismaMock.zoneState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { zoneId_childId: { zoneId: 'z1', childId: 'c1' } },
        update: expect.objectContaining({
          pendingTransition: true,
          pendingSince: basePoint.recordedAt,
        }),
      }),
    );
    expect(prismaMock.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('вторая точка внутри через 65с — создаёт entry-событие', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 100 }]);
    prismaMock.zoneState.findMany.mockResolvedValue([
      {
        zoneId: 'z1',
        childId: 'c1',
        isInside: false,
        pendingTransition: true,
        pendingSince: new Date('2026-04-20T09:58:55Z'), // 65s ago
      },
    ]);
    await svc.processPoint(prismaMock as never, basePoint);
    expect(prismaMock.zoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        zoneId: 'z1',
        childId: 'c1',
        type: 'entry',
        lat: 48.48,
        lon: 135.08,
      }),
    });
  });

  it('точка в буфере (exit hysteresis) сохраняет isInside=true, события нет', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: 'z1', radius: 200, distance_m: 215 }, // outside 200, inside 200+buffer(200)=200+30=230
    ]);
    prismaMock.zoneState.findMany.mockResolvedValue([
      {
        zoneId: 'z1',
        childId: 'c1',
        isInside: true,
        pendingTransition: false,
        pendingSince: null,
      },
    ]);
    await svc.processPoint(prismaMock as never, basePoint);
    expect(prismaMock.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('ребёнок вне radius+buffer (не в candidates) — после debounce exit-событие', async () => {
    // No candidate returned (candidate query filtered by ST_DWithin with buffer, this child is farther)
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.zoneState.findMany.mockResolvedValue([
      {
        zoneId: 'z1',
        childId: 'c1',
        isInside: true,
        pendingTransition: true,
        pendingSince: new Date('2026-04-20T09:58:55Z'), // 65s ago
      },
    ]);
    await svc.processPoint(prismaMock as never, basePoint);
    expect(prismaMock.zoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        zoneId: 'z1',
        type: 'exit',
      }),
    });
  });

  it('точка внутри зоны и state.isInside=true (стабильное) — не создаёт события', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 100 }]);
    prismaMock.zoneState.findMany.mockResolvedValue([
      {
        zoneId: 'z1',
        childId: 'c1',
        isInside: true,
        pendingTransition: false,
        pendingSince: null,
      },
    ]);
    await svc.processPoint(prismaMock as never, basePoint);
    expect(prismaMock.zoneEvent.create).not.toHaveBeenCalled();
    // Should not upsert since state is already stable
  });
});

// v0.59.0 — событие по точке, досланной из офлайн-очереди телефона.
describe('ZoneDetectionService push: delayed flag', () => {
  let svc: ZoneDetectionService;
  let sendHybrid: jest.Mock;
  const prisma = {
    ...prismaMock,
    child: { findUnique: jest.fn().mockResolvedValue({ name: 'Тимофей' }) },
    zone: { findUnique: jest.fn().mockResolvedValue({ name: 'Школа' }) },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sendHybrid = jest.fn().mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        ZoneDetectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: FcmService, useValue: { sendHybridToToken: sendHybrid } },
        {
          provide: ParentDevicesService,
          useValue: {
            findActiveByFamilyId: jest
              .fn()
              .mockResolvedValue([{ fcmToken: 'fcm1', rustorePushToken: null }]),
            clearTokenByExpired: jest.fn(),
            clearRustoreByExpired: jest.fn(),
          },
        },
      ],
    }).compile();
    svc = module.get(ZoneDetectionService);
    prisma.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 250, distance_m: 100 }]);
  });

  async function entryAt(recordedAt: Date): Promise<Record<string, string>> {
    prisma.zoneState.findMany.mockResolvedValue([
      {
        zoneId: 'z1',
        childId: 'c1',
        isInside: false,
        pendingTransition: true,
        pendingSince: new Date(recordedAt.getTime() - 65_000),
      },
    ]);
    await svc.processPoint(prisma as never, {
      familyId: 'f1',
      childId: 'c1',
      deviceId: 'd1',
      lat: 48.48,
      lon: 135.08,
      accuracy: 10,
      recordedAt,
    });
    // push уходит fire-and-forget после события — дождёмся цепочки промисов
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid).toHaveBeenCalledTimes(1);
    return sendHybrid.mock.calls[0][0].data as Record<string, string>;
  }

  it('marks the push as delayed when the point is older than 3 minutes', async () => {
    const data = await entryAt(new Date(Date.now() - 60 * 60_000));
    expect(data.type).toBe('GEOFENCE_ENTER');
    expect(data.delayed).toBe('1');
  });

  it('live event has no delayed flag', async () => {
    const data = await entryAt(new Date(Date.now() - 30_000));
    expect(data.delayed).toBeUndefined();
  });
});
