import { Controller, Get } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

type LivenessResponse = {
  status: 'ok';
  timestamp: string;
};

type ReadinessResponse = {
  status: 'ok' | 'error';
  timestamp: string;
  db: 'up' | 'down';
  redis: 'up' | 'down';
};

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('healthz')
  check(): LivenessResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readyz')
  async ready(): Promise<ReadinessResponse> {
    const [dbStatus, redisStatus] = await Promise.all([this.checkDb(), this.checkRedis()]);

    const status: 'ok' | 'error' = dbStatus === 'up' && redisStatus === 'up' ? 'ok' : 'error';

    return {
      status,
      timestamp: new Date().toISOString(),
      db: dbStatus,
      redis: redisStatus,
    };
  }

  private async checkDb(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      const response = await this.redis.getClient().ping();
      return response === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
