import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ZonesService } from './zones.service';
import { MAX_ZONES_PER_FAMILY } from './dto/constants';

const prismaMock = {
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
  $transaction: jest.fn(async (fn: unknown) =>
    typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(prismaMock) : fn,
  ),
};

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
