import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * v0.71.0: отметка «access-токены пользователя, выданные раньше этого момента,
 * устарели». Ставится при смене членства в семье (принял приглашение, вышел,
 * удалён владельцем, передал права): JWT несёт familyId и живёт 15 минут,
 * а JwtAuthGuard в БД не ходит. Guard отвечает 401 `token_stale`, клиент
 * делает refresh и получает токен с актуальным членством.
 */
const KEY_PREFIX = 'auth:stale:';
// Чуть дольше жизни access-токена (15 мин) + clockTolerance.
const TTL_SEC = 16 * 60;

@Injectable()
export class StaleTokenService {
  private readonly logger = new Logger(StaleTokenService.name);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async markStale(userIds: string[]): Promise<void> {
    const nowMs = Date.now();
    for (const id of new Set(userIds)) {
      try {
        await this.redis.set(KEY_PREFIX + id, String(nowMs), TTL_SEC);
      } catch (e) {
        this.logger.warn(`markStale(${id}) failed: ${(e as Error).message}`);
      }
    }
  }

  /** true — токен выпущен (мс) до последней смены членства. Fail-open при сбое Redis. */
  async isStale(userId: string, issuedAtMs: number | undefined): Promise<boolean> {
    if (issuedAtMs === undefined) return false;
    try {
      const raw = await this.redis.get(KEY_PREFIX + userId);
      if (!raw) return false;
      return issuedAtMs < Number(raw);
    } catch (e) {
      this.logger.warn(`isStale(${userId}) failed: ${(e as Error).message}`);
      return false;
    }
  }
}
