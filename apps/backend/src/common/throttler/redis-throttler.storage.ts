import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

/**
 * Redis-backed ThrottlerStorage. Инкремент через INCR + PTTL atomic (MULTI).
 * Ключ: `thr:<throttlerName>:<tracker>`, где tracker = IP + URL (NestJS дефолт)
 * или override через @Throttle() + @SkipThrottle().
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    _limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const k = `thr:${throttlerName}:${key}`;
    let hits: number;
    let pttl: number;
    try {
      const tx = this.redis.multi();
      tx.incr(k);
      tx.pttl(k);
      const res = (await tx.exec()) as [Error | null, number][];
      hits = Number(res[0][1]);
      pttl = Number(res[1][1]);
      if (pttl < 0) {
        await this.redis.pexpire(k, ttl);
        pttl = ttl;
      }
    } catch {
      // Redis недоступен — лимит не считаем, запрос пропускаем (fail-open).
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
    const isBlocked = hits > _limit;
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(pttl / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(pttl / 1000) : 0,
    };
  }
}
