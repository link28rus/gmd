import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateParentLocationDeviceDto,
  ParentLocationDeviceInfo,
  ParentLocationPoint,
} from './dto/parent-location.dto';

/** Контекст запроса с X-Parent-Location-Token. */
export interface ParentLocationAuthContext {
  deviceId: string;
  userId: string;
}

export interface ParentIngestResult {
  accepted: number;
  rejected: number;
  /**
   * v0.73.0: всегда false — точки собираются и при выключенном «Показывать
   * меня семье». Поле оставлено: служба v0.70–v0.72 по `true` останавливается.
   */
  sharingDisabled: boolean;
  /** v0.73.0: живой сигнал «Найти телефон» — запасной путь, если push не дошёл. */
  signal?: { id: string };
}

/** v0.73.0: сколько живёт запрошенный сигнал без подтверждения телефоном. */
export const SIGNAL_TTL_MS = 5 * 60 * 1000;

/** Сигнал ждёт телефона: запрошен не раньше TTL и ещё не подтверждён. */
export function isSignalLive(
  d: { signalId: string | null; signalRequestedAt: Date | null; signalAckedAt: Date | null },
  now: number,
): boolean {
  return (
    d.signalId !== null &&
    d.signalRequestedAt !== null &&
    d.signalAckedAt === null &&
    now - d.signalRequestedAt.getTime() < SIGNAL_TTL_MS
  );
}

/** v0.70.0: элемент `parents` в GET /family/locations/latest. */
export interface FamilyParentPoint {
  userId: string;
  name: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  ageSec: number;
  isMe: boolean;
}

// Окно времени. v0.73.1: в прошлое — 30 дней (= retention), а не 7, как у
// детей: украденный телефон может неделями копить точки без сети, а
// «Найти телефон» должен получить их все, как только связь появится.
export const PARENT_OUT_OF_WINDOW_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const OUT_OF_WINDOW_FUTURE_MS = 2 * 60 * 1000;
/** Точки грубее — бесполезны для метки на карте. Служба сама режет > 100 м. */
export const PARENT_ACCURACY_MAX_M = 500;

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

/** `user.name` → `firstName` → часть email до `@`. */
export function displayName(u: {
  name: string | null;
  firstName: string | null;
  email: string;
}): string {
  const name = u.name?.trim();
  if (name) return name;
  const first = u.firstName?.trim();
  if (first) return first;
  return u.email.split('@')[0];
}

/**
 * v0.70.0: геолокация родителя для общей карты семьи.
 *
 * Нативная служба приложения родителя не может пользоваться JWT (refresh
 * ротируется, повтор старого отзывает все сессии), поэтому у неё свой
 * долгоживущий токен — как device-token ребёнка (sha256 в БД).
 */
@Injectable()
export class ParentLocationService {
  private readonly logger = new Logger(ParentLocationService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createDevice(
    userId: string,
    dto: CreateParentLocationDeviceDto,
  ): Promise<{ deviceId: string; token: string }> {
    const token = randomBytes(32).toString('base64url');
    const device = await this.prisma.$transaction(async (tx) => {
      if (dto.replaceDeviceId) {
        // Только своё устройство; чужой id молча игнорируем.
        await tx.parentLocationDevice.updateMany({
          where: { id: dto.replaceDeviceId, userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return tx.parentLocationDevice.create({
        data: {
          userId,
          tokenHash: sha256(token),
          platform: dto.platform ?? null,
          appVersion: dto.appVersion ?? null,
        },
        select: { id: true },
      });
    });
    return { deviceId: device.id, token };
  }

  /** Отзыв своего устройства (выход из аккаунта). Повторный отзыв — no-op. */
  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.prisma.parentLocationDevice.findFirst({
      where: { id: deviceId, userId },
      select: { id: true, revokedAt: true },
    });
    if (!device) {
      throw new NotFoundException({ code: 'device_not_found', message: 'Device not found' });
    }
    if (device.revokedAt) return;
    await this.prisma.parentLocationDevice.update({
      where: { id: device.id },
      data: { revokedAt: new Date() },
    });
  }

  /** null — токен неизвестен, отозван или пользователь удалён (→ 401). */
  async verifyToken(token: string): Promise<ParentLocationAuthContext | null> {
    const device = await this.prisma.parentLocationDevice.findFirst({
      where: { tokenHash: sha256(token), revokedAt: null },
      select: { id: true, userId: true, user: { select: { deletedAt: true } } },
    });
    if (!device || device.user.deletedAt) return null;
    return { deviceId: device.id, userId: device.userId };
  }

  async ingestPoints(
    ctx: ParentLocationAuthContext,
    points: ParentLocationPoint[],
    deviceInfo?: ParentLocationDeviceInfo,
  ): Promise<ParentIngestResult> {
    const now = Date.now();
    const valid = points.filter((p) => {
      const ts = new Date(p.recordedAt).getTime();
      if (ts < now - PARENT_OUT_OF_WINDOW_PAST_MS || ts > now + OUT_OF_WINDOW_FUTURE_MS)
        return false;
      if (p.accuracy !== undefined && p.accuracy > PARENT_ACCURACY_MAX_M) return false;
      return true;
    });

    // v0.73.0: точки пишутся независимо от «Показывать меня семье» — флаг
    // фильтрует только чтение семьёй (getLatestForFamily). Свои точки
    // владелец видит в «Найти телефон».
    let accepted = 0;
    if (valid.length > 0) {
      const values = valid.map(
        (p) => Prisma.sql`(
          ${createId()},
          ${ctx.userId},
          ${ctx.deviceId},
          ${p.lat},
          ${p.lon},
          ${p.accuracy ?? null},
          ${p.speed ?? null},
          ${p.bearing ?? null},
          ${p.batteryLevel ?? null},
          ${p.isCharging ?? null},
          ${p.provider ?? null},
          ${p.isMock ?? false},
          ${new Date(p.recordedAt)}
        )`,
      );
      const inserted = await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "parent_locations" (
          "id","userId","deviceId","lat","lon","accuracy","speed","bearing","batteryLevel","isCharging","provider","isMock","recordedAt"
        ) VALUES ${Prisma.join(values)}
        ON CONFLICT ("deviceId","recordedAt") DO NOTHING
      `);
      accepted = Number(inserted);
    }
    const device = await this.prisma.parentLocationDevice.update({
      where: { id: ctx.deviceId },
      data: {
        lastSeenAt: new Date(),
        ...(deviceInfo?.name !== undefined ? { deviceName: deviceInfo.name } : {}),
        ...(deviceInfo?.pushToken !== undefined ? { fcmToken: deviceInfo.pushToken } : {}),
      },
      select: { signalId: true, signalRequestedAt: true, signalAckedAt: true },
    });

    const signal = isSignalLive(device, Date.now()) ? { id: device.signalId! } : undefined;
    this.logger.log(
      `parent ingest user=${ctx.userId} device=${ctx.deviceId} in=${points.length} accepted=${accepted}${signal ? ` signal=${signal.id}` : ''}`,
    );
    return {
      accepted,
      rejected: points.length - accepted,
      sharingDisabled: false,
      ...(signal ? { signal } : {}),
    };
  }

  async getSharing(userId: string): Promise<{ enabled: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { shareLocationWithFamily: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new NotFoundException({ code: 'user_not_found', message: 'User not found' });
    }
    return { enabled: user.shareLocationWithFamily };
  }

  /**
   * Видимость для семьи. v0.73.0: точки при выключении не удаляются — их
   * видит только сам владелец («Найти телефон»), семье метка не отдаётся.
   */
  async setSharing(userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, deletedAt: null },
      data: { shareLocationWithFamily: enabled },
    });
    if (updated.count === 0) {
      throw new NotFoundException({ code: 'user_not_found', message: 'User not found' });
    }
    return { enabled };
  }

  /**
   * Последняя точка каждого родителя семьи: член семьи, не удалён, флаг
   * включён, точка без isMock и не старше 30 дней (retention точек).
   */
  async getLatestForFamily(familyId: string, meUserId: string): Promise<FamilyParentPoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        name: string | null;
        firstName: string | null;
        email: string;
        lat: number;
        lon: number;
        accuracy: number | null;
        recordedAt: Date;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (pl."userId")
             pl."userId", u.name, u."firstName", u.email,
             pl.lat, pl.lon, pl.accuracy, pl."recordedAt"
      FROM parent_locations pl
      JOIN memberships m ON m."userId" = pl."userId" AND m."familyId" = ${familyId}
      JOIN users u ON u.id = pl."userId"
      WHERE u."deletedAt" IS NULL
        AND u."shareLocationWithFamily" = true
        AND pl."isMock" = false
        AND pl."recordedAt" > now() - interval '30 days'
      ORDER BY pl."userId", pl."recordedAt" DESC
    `);
    const now = Date.now();
    return rows.map((r) => ({
      userId: r.userId,
      name: displayName(r),
      lat: r.lat,
      lon: r.lon,
      accuracy: r.accuracy,
      recordedAt: r.recordedAt.toISOString(),
      ageSec: Math.max(0, Math.floor((now - r.recordedAt.getTime()) / 1000)),
      isMe: r.userId === meUserId,
    }));
  }
}
