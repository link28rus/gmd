import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prismaMock: Partial<PrismaService>;
  let redisMock: Partial<RedisService>;

  beforeEach(async () => {
    prismaMock = {
      $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
    } as unknown as Partial<PrismaService>;

    redisMock = {
      getClient: jest.fn().mockReturnValue({ ping: jest.fn().mockResolvedValue('PONG') }),
    } as unknown as Partial<RedisService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('/healthz (liveness)', () => {
    it('should return {status: "ok"}', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
    });

    it('should include timestamp as ISO string', () => {
      const result = controller.check();
      expect(result).toHaveProperty('timestamp');
      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });

  describe('/readyz (readiness)', () => {
    it('should return ok when both db and redis respond', async () => {
      const result = await controller.ready();
      expect(result.status).toBe('ok');
      expect(result.db).toBe('up');
      expect(result.redis).toBe('up');
    });

    it('should return db:"down" and status:"error" if Prisma throws', async () => {
      (prismaMock.$queryRaw as jest.Mock).mockRejectedValueOnce(new Error('connection refused'));
      const result = await controller.ready();
      expect(result.status).toBe('error');
      expect(result.db).toBe('down');
      expect(result.redis).toBe('up');
    });

    it('should return redis:"down" and status:"error" if Redis throws', async () => {
      const pingMock = jest.fn().mockRejectedValueOnce(new Error('timeout'));
      (redisMock.getClient as jest.Mock).mockReturnValueOnce({ ping: pingMock });
      const result = await controller.ready();
      expect(result.status).toBe('error');
      expect(result.db).toBe('up');
      expect(result.redis).toBe('down');
    });
  });
});
