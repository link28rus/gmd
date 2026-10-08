import { Inject, Injectable, Logger } from '@nestjs/common';
import { FcmService } from '../fcm/fcm.service';
import { ParentDevicesService } from '../parent-devices/parent-devices.service';
import { RedisService } from '../redis/redis.service';

/** Сколько живёт отметка «родитель смотрит карту ребёнка» без продления. */
export const WATCH_TTL_SEC = 90;
/** Не чаще одного push о новой точке на ребёнка за это время. */
export const PUSH_THROTTLE_SEC = 3;
/** Тихий push: приложение родителя перезапрашивает точку, уведомления нет. */
export const LOCATION_UPDATED_TYPE = 'LOCATION_UPDATED';

const watchKey = (childId: string): string => `loc-watch:${childId}`;
const throttleKey = (childId: string): string => `loc-push:${childId}`;

/**
 * v0.69.0: realtime-обновление карты ребёнка у родителя.
 *
 * Открытый экран ребёнка в приложении родителя раз в 30 с отмечается здесь
 * (`watch`). Пока отметка жива, каждая принятая порция точек ребёнка шлёт
 * этому родителю тихий data-push `LOCATION_UPDATED`, и экран сразу
 * перезапрашивает точку и трек. Родителям, у которых экран закрыт, push не
 * уходит — не будим их телефоны на каждую точку весь день.
 *
 * Хранение: Redis sorted set `loc-watch:<childId>`, member = userId,
 * score = момент истечения (мс). Протухшие записи чистятся при чтении.
 */
@Injectable()
export class LocationWatchService {
  private readonly logger = new Logger(LocationWatchService.name);

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(FcmService) private readonly fcm: FcmService,
    @Inject(ParentDevicesService) private readonly parentDevices: ParentDevicesService,
  ) {}

  async watch(childId: string, userId: string): Promise<void> {
    const key = watchKey(childId);
    await this.redis
      .getClient()
      .multi()
      .zadd(key, Date.now() + WATCH_TTL_SEC * 1000, userId)
      .expire(key, WATCH_TTL_SEC * 2)
      .exec();
  }

  /**
   * v0.70.0: отметка «смотрю» сразу на нескольких детей (общая карта семьи
   * на главном экране родителя) — одним MULTI.
   */
  async watchMany(childIds: string[], userId: string): Promise<void> {
    if (childIds.length === 0) return;
    const expiresAt = Date.now() + WATCH_TTL_SEC * 1000;
    const multi = this.redis.getClient().multi();
    for (const childId of childIds) {
      const key = watchKey(childId);
      multi.zadd(key, expiresAt, userId).expire(key, WATCH_TTL_SEC * 2);
    }
    await multi.exec();
  }

  async watchers(childId: string): Promise<string[]> {
    const key = watchKey(childId);
    const client = this.redis.getClient();
    await client.zremrangebyscore(key, '-inf', Date.now());
    return client.zrange(key, 0, -1);
  }

  /**
   * Шлёт `LOCATION_UPDATED` устройствам родителей, которые сейчас смотрят
   * карту ребёнка. Ошибки не бросает — это подсказка «обнови», а не данные:
   * при сбое экран родителя всё равно подтянет точку опросом.
   */
  async notifyNewPoints(childId: string, familyId: string): Promise<void> {
    try {
      const users = await this.watchers(childId);
      if (users.length === 0) return;

      const first = await this.redis
        .getClient()
        .set(throttleKey(childId), '1', 'EX', PUSH_THROTTLE_SEC, 'NX');
      if (first !== 'OK') return;

      const watching = new Set(users);
      const targets = (await this.parentDevices.findActiveByFamilyId(familyId)).filter(
        (d) => watching.has(d.userId) && (d.fcmToken || d.rustorePushToken),
      );
      await Promise.all(
        targets.map((d) =>
          this.fcm.sendHybridToToken({
            tokens: { fcmToken: d.fcmToken, rustorePushToken: d.rustorePushToken },
            data: { type: LOCATION_UPDATED_TYPE, childId },
            // Экран открыт — телефон и так не спит, будить из Doze не нужно.
            priority: 'normal',
            // Через минуту подсказка бесполезна: опрос уже сработал.
            ttlSec: 60,
            collapseKey: `loc-${childId}`,
            label: `${LOCATION_UPDATED_TYPE} child=${childId}`,
            onInvalidFcmToken: (token) => this.parentDevices.clearTokenByExpired(token),
            onInvalidRustoreToken: (token) => this.parentDevices.clearRustoreByExpired(token),
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `location push failed child=${childId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
