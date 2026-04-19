import { Inject, Injectable } from '@nestjs/common';
import { hash, verify as argonVerify } from '@node-rs/argon2';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RedisService } from '../redis/redis.service';

export interface PasswordConfig {
  lockAfter: number;
  lockTtlSec: number;
}

export const PASSWORD_CONFIG = Symbol('PASSWORD_CONFIG');

export interface LockStatus {
  locked: boolean;
  retryAfterSec: number;
}

@Injectable()
export class PasswordService {
  constructor(
    private readonly redis: RedisService,
    @Inject(PASSWORD_CONFIG) private readonly cfg: PasswordConfig,
  ) {}

  async hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(storedHash: string, plain: string): Promise<boolean> {
    return argonVerify(storedHash, plain);
  }

  async recordFailure(email: string): Promise<LockStatus> {
    const key = `pwlock:${email.toLowerCase()}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, this.cfg.lockTtlSec);
    const locked = n >= this.cfg.lockAfter;
    const retry = locked ? await this.redis.ttl(key) : 0;
    return { locked, retryAfterSec: retry };
  }

  async isLocked(email: string): Promise<LockStatus> {
    const key = `pwlock:${email.toLowerCase()}`;
    const n = Number((await this.redis.get(key)) ?? 0);
    const locked = n >= this.cfg.lockAfter;
    const retry = locked ? await this.redis.ttl(key) : 0;
    return { locked, retryAfterSec: retry };
  }

  async clearFailures(email: string): Promise<void> {
    await this.redis.del(`pwlock:${email.toLowerCase()}`);
  }
}
