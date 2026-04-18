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
    const tx = this.redis.multi();
    tx.incr(k);
    tx.pttl(k);
    const res = (await tx.exec()) as [Error | null, number][];
    const hits = Number(res[0][1]);
    let pttl = Number(res[1][1]);
    if (pttl < 0) {
      await this.redis.pexpire(k, ttl);
      pttl = ttl;
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
