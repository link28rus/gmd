import { Inject, Injectable } from '@nestjs/common';
import { hash, verify as argonVerify } from '@node-rs/argon2';
import type { RedisService } from '../redis/redis.service';

export interface PinConfig {
  lockAfter: number;
  lockTtlSec: number;
  // Срок «свежести» успешной PIN-верификации. Клиент после POST /me/pin/verify
  // получает право дёргать PATCH /children/:id/protection без повторного ввода
  // PIN в течение этого окна. По умолчанию — 5 минут (UX баланс).
  verifyTtlSec: number;
}

export const PIN_CONFIG = Symbol('PIN_CONFIG');

export interface PinLockStatus {
  locked: boolean;
  retryAfterSec: number;
}

@Injectable()
export class PinService {
  constructor(
    private readonly redis: RedisService,
    @Inject(PIN_CONFIG) private readonly cfg: PinConfig,
  ) {}

  async hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(storedHash: string, plain: string): Promise<boolean> {
    return argonVerify(storedHash, plain);
  }

  async recordFailure(userId: string): Promise<PinLockStatus> {
    const key = `pinlock:${userId}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, this.cfg.lockTtlSec);
    const locked = n >= this.cfg.lockAfter;
    const retryAfterSec = locked ? await this.redis.ttl(key) : 0;
    return { locked, retryAfterSec };
  }

  async isLocked(userId: string): Promise<PinLockStatus> {
    const key = `pinlock:${userId}`;
    const n = Number((await this.redis.get(key)) ?? 0);
    const locked = n >= this.cfg.lockAfter;
    const retryAfterSec = locked ? await this.redis.ttl(key) : 0;
    return { locked, retryAfterSec };
  }

  async clearFailures(userId: string): Promise<void> {
    await this.redis.del(`pinlock:${userId}`);
  }

  // «Verified marker» — факт успешной верификации PIN в Redis с TTL.
  // Позволяет PATCH /children/:id/protection пройти без повторного ввода PIN.
  async markVerified(userId: string): Promise<void> {
    await this.redis.set(`pinverify:${userId}`, '1', this.cfg.verifyTtlSec);
  }

  async isVerified(userId: string): Promise<boolean> {
    const v = await this.redis.get(`pinverify:${userId}`);
    return v === '1';
  }

  async clearVerified(userId: string): Promise<void> {
    await this.redis.del(`pinverify:${userId}`);
  }
}
