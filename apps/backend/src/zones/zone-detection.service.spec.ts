import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
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
      providers: [ZoneDetectionService, { provide: PrismaService, useValue: prismaMock }],
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
