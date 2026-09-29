import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import type { RegisterRustoreTokenDto } from './dto/register-rustore-token.dto';

/**
 * v0.46: Регистрация FCM-токенов мобильных устройств родителя.
 *
 * Один user может иметь несколько устройств. Один FCM-токен — на (project, app
 * installation), переустановка app даёт новый токен. UNIQUE constraint на
 * fcmToken: при коллизии (тот же токен от другого user'а — означает что
 * устройство сменило логин) перезаписываем userId/lastSeenAt и сбрасываем
 * revokedAt.
 */
@Injectable()
export class ParentDevicesService {
  private readonly logger = new Logger(ParentDevicesService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterFcmTokenDto): Promise<{ id: string }> {
    const now = new Date();
    const result = await this.prisma.parentDevice.upsert({
      where: { fcmToken: dto.fcmToken },
      create: {
        userId,
        fcmToken: dto.fcmToken,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        appVersion: dto.appVersion ?? null,
        fcmTokenUpdatedAt: now,
        lastSeenAt: now,
      },
      update: {
        userId,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        appVersion: dto.appVersion ?? null,
        fcmTokenUpdatedAt: now,
        lastSeenAt: now,
        revokedAt: null,
      },
    });
    this.logger.log(
      `parent-device registered id=${result.id} user=${userId} platform=${dto.platform}`,
    );
    return { id: result.id };
  }

  async revoke(userId: string, fcmToken: string): Promise<void> {
    await this.prisma.parentDevice.updateMany({
      where: { userId, fcmToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByToken(fcmToken: string): Promise<void> {
    await this.prisma.parentDevice
      .updateMany({ where: { fcmToken, revokedAt: null }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  async clearTokenByExpired(fcmToken: string): Promise<void> {
    // Token инвалидирован Firebase'ом — отзываем запись чтобы дальше не слать.
    await this.revokeByToken(fcmToken);
  }

  /**
   * v0.51 RuStore Push: регистрирует rustorePushToken parent-устройства.
   *
   * Семантика upsert'а — по полю rustorePushToken. Если на этот же user
   * уже есть запись с fcmToken и приходит RuStore-токен — мы создаём
   * вторую запись (отдельное устройство в нашей логике), потому что нет
   * способа сопоставить FCM и RuStore токены без передачи fcmToken
   * клиентом. Дубль приемлем на MVP — push.service.ts шлёт через каждый
   * канал отдельно, и устройство решает какой канал у него реально
   * доставляется (он подписан на оба).
   */
  async registerRustore(userId: string, dto: RegisterRustoreTokenDto): Promise<{ id: string }> {
    const now = new Date();
    const result = await this.prisma.parentDevice.upsert({
      where: { rustorePushToken: dto.rustorePushToken },
      create: {
        userId,
        rustorePushToken: dto.rustorePushToken,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        appVersion: dto.appVersion ?? null,
        rustorePushTokenUpdatedAt: now,
        lastSeenAt: now,
      },
      update: {
        userId,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        appVersion: dto.appVersion ?? null,
        rustorePushTokenUpdatedAt: now,
        lastSeenAt: now,
        revokedAt: null,
      },
    });
    this.logger.log(
      `parent-device rustore registered id=${result.id} user=${userId} platform=${dto.platform}`,
    );
    return { id: result.id };
  }

  async revokeRustore(userId: string, rustorePushToken: string): Promise<void> {
    await this.prisma.parentDevice.updateMany({
      where: { userId, rustorePushToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async clearRustoreByExpired(rustorePushToken: string): Promise<void> {
    await this.prisma.parentDevice
      .updateMany({
        where: { rustorePushToken, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async findActiveByFamilyId(familyId: string): Promise<
    Array<{
      id: string;
      userId: string;
      fcmToken: string | null;
      rustorePushToken: string | null;
      appVersion: string | null;
    }>
  > {
    const memberships = await this.prisma.membership.findMany({
      where: { familyId },
      select: { userId: true },
    });
    if (memberships.length === 0) return [];
    const rows = await this.prisma.parentDevice.findMany({
      where: {
        userId: { in: memberships.map((m) => m.userId) },
        revokedAt: null,
      },
      // v0.65.0: userId — чтобы push о зонах учитывал личные настройки родителя.
      select: {
        id: true,
        userId: true,
        fcmToken: true,
        rustorePushToken: true,
        appVersion: true,
      },
    });
    return rows;
  }
}
