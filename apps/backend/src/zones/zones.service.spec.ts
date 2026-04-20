import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ZonesService } from './zones.service';
import { MAX_ZONES_PER_FAMILY } from './dto/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prismaMock: any = {
  zone: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
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
  },
  zoneEvent: {
    findMany: jest.fn(),
  },
  child: { findMany: jest.fn() },
};
prismaMock.$transaction = jest.fn(async (fn: unknown) =>
  typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(prismaMock) : fn,
);

describe('ZonesService.create', () => {
  let svc: ZonesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('создаёт зону с ZoneChildAssignment и инициализирует ZoneState', async () => {
    prismaMock.zone.count.mockResolvedValue(3);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    prismaMock.zone.create.mockResolvedValue({
      id: 'z1',
      familyId: 'f1',
      name: 'Школа',
      color: '#22c55e',
      icon: 'school',
      centerLat: 48.48,
      centerLon: 135.08,
      radius: 250,
      createdBy: 'u1',
      createdAt: new Date('2026-04-20T10:00:00Z'),
      updatedAt: new Date('2026-04-20T10:00:00Z'),
    });

    const result = await svc.create('f1', 'u1', {
      name: 'Школа',
      color: '#22c55e',
      icon: 'school',
      centerLat: 48.48,
      centerLon: 135.08,
      radius: 250,
      childIds: ['c1', 'c2'],
    });

    expect(prismaMock.zone.create).toHaveBeenCalled();
    expect(prismaMock.zoneChildAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { zoneId: 'z1', childId: 'c1' },
        { zoneId: 'z1', childId: 'c2' },
      ],
    });
    expect(prismaMock.zoneState.createMany).toHaveBeenCalledWith({
      data: [
        { zoneId: 'z1', childId: 'c1', isInside: false },
        { zoneId: 'z1', childId: 'c2', isInside: false },
      ],
    });
    expect(result.id).toBe('z1');
    expect(result.childIds).toEqual(['c1', 'c2']);
  });

  it('бросает ConflictException при превышении лимита', async () => {
    prismaMock.zone.count.mockResolvedValue(MAX_ZONES_PER_FAMILY);
    await expect(
      svc.create('f1', 'u1', {
        name: 'X',
        color: '#22c55e',
        icon: 'home',
        centerLat: 0,
        centerLon: 0,
        radius: 100,
        childIds: [],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('бросает NotFoundException если childId не из этой семьи', async () => {
    prismaMock.zone.count.mockResolvedValue(0);
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c1' }]);
    await expect(
      svc.create('f1', 'u1', {
        name: 'X',
        color: '#22c55e',
        icon: 'home',
        centerLat: 0,
        centerLon: 0,
        radius: 100,
        childIds: ['c1', 'c2'],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ZonesService.list', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('возвращает зоны семьи с assignments и states', async () => {
    prismaMock.zone.findMany.mockResolvedValue([
      {
        id: 'z1',
        familyId: 'f1',
        name: 'Школа',
        color: '#22c55e',
        icon: 'school',
        centerLat: 48,
        centerLon: 135,
        radius: 250,
        createdBy: 'u1',
        createdAt: new Date('2026-04-20'),
        updatedAt: new Date('2026-04-20'),
        assignments: [{ childId: 'c1' }, { childId: 'c2' }],
        states: [
          { childId: 'c1', isInside: true },
          { childId: 'c2', isInside: false },
        ],
      },
    ]);
    const result = await svc.list('f1');
    expect(result).toHaveLength(1);
    expect(result[0].childIds).toEqual(['c1', 'c2']);
    expect(result[0].states).toEqual([
      { childId: 'c1', isInside: true },
      { childId: 'c2', isInside: false },
    ]);
  });
});

describe('ZonesService.get', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('бросает NotFoundException для чужой семьи (anti-enumeration)', async () => {
    prismaMock.zone.findFirst.mockResolvedValue(null);
    await expect(svc.get('f1', 'z1')).rejects.toThrow(NotFoundException);
  });
});

describe('ZonesService.update', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('обновляет assignments: добавляет новые, удаляет убранные, синхронизирует ZoneState', async () => {
    prismaMock.zone.findFirst.mockResolvedValue({
      id: 'z1',
      familyId: 'f1',
      name: 'X',
      color: '#22c55e',
      icon: 'home',
      centerLat: 0,
      centerLon: 0,
      radius: 100,
      createdBy: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      assignments: [{ childId: 'c1' }, { childId: 'c2' }],
    });
    prismaMock.child.findMany.mockResolvedValue([{ id: 'c2' }, { id: 'c3' }]);
    prismaMock.zone.update.mockResolvedValue({
      id: 'z1',
      familyId: 'f1',
      name: 'X',
      color: '#22c55e',
      icon: 'home',
      centerLat: 0,
      centerLon: 0,
      radius: 100,
      createdBy: 'u1',
      createdAt: new Date(),
      updatedAt: new Date(),
      assignments: [{ childId: 'c2' }, { childId: 'c3' }],
      states: [
        { childId: 'c2', isInside: false },
        { childId: 'c3', isInside: false },
      ],
    });

    await svc.update('f1', 'z1', { childIds: ['c2', 'c3'] });

    expect(prismaMock.zoneChildAssignment.deleteMany).toHaveBeenCalledWith({
      where: { zoneId: 'z1', childId: { in: ['c1'] } },
    });
    expect(prismaMock.zoneState.deleteMany).toHaveBeenCalledWith({
      where: { zoneId: 'z1', childId: { in: ['c1'] } },
    });
    expect(prismaMock.zoneChildAssignment.createMany).toHaveBeenCalledWith({
      data: [{ zoneId: 'z1', childId: 'c3' }],
    });
    expect(prismaMock.zoneState.createMany).toHaveBeenCalledWith({
      data: [{ zoneId: 'z1', childId: 'c3', isInside: false }],
    });
  });
});

describe('ZonesService.softDelete', () => {
  let svc: ZonesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
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
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [ZonesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    svc = module.get(ZonesService);
  });

  it('возвращает события семьи с pagination cursor', async () => {
    prismaMock.zoneEvent.findMany.mockResolvedValue([
      {
        id: 'e1',
        zoneId: 'z1',
        childId: 'c1',
        type: 'entry',
        lat: 48,
        lon: 135,
        accuracy: 10,
        recordedAt: new Date('2026-04-20T10:00:00Z'),
        createdAt: new Date('2026-04-20T10:00:05Z'),
        zone: { name: 'Школа', color: '#22c55e', icon: 'school' },
        child: { name: 'Аня' },
      },
    ]);

    const result = await svc.listEvents('f1', { limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].zoneName).toBe('Школа');
    expect(result.items[0].childName).toBe('Аня');
    expect(result.nextCursor).toBeNull();
  });
});
