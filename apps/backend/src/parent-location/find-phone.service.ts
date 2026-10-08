import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { displayName, isSignalLive, SIGNAL_TTL_MS } from './parent-location.service';
import type { ParentLocationAuthContext } from './parent-location.service';

/** Сколько звонит телефон (SignalSoundService.SIGNAL_DURATION_MS в mobile-parent). */
const RING_DURATION_MS = 60 * 1000;
/** Маршрут — по дням; окно с запасом на часовой пояс и переход через полночь. */
const MAX_TRACK_SPAN_MS = 2 * 24 * 60 * 60 * 1000;
/** Retention точек — 30 дней (pg_cron); раньше смотреть нечего. */
const MAX_TRACK_AGE_MS = 31 * 24 * 60 * 60 * 1000;
/** Служба шлёт точку не чаще раза в минуту — за двое суток меньше 3000. */
const MAX_TRACK_POINTS = 5000;

export type SignalStatus = 'pending' | 'ringing' | 'done' | 'expired';

export interface MyPhoneDto {
  id: string;
  /** Модель телефона — её присылает служба геолокации. */
  deviceName: string | null;
  /** v0.74.0: имя, заданное в кабинете; показывать вместо модели. */
  customName: string | null;
  /** v0.74.0: телефон вошёл под аккаунтом запросившего. */
  isMine: boolean;
  /** v0.74.0: чей телефон — имя взрослого (владелец семьи видит телефоны всех). */
  ownerName: string;
  platform: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  /** Есть FCM-токен — сигнал уйдёт сразу, а не со следующей выгрузкой точек. */
  canPush: boolean;
  latest: {
    lat: number;
    lon: number;
    accuracy: number | null;
    recordedAt: string;
    ageSec: number;
    batteryLevel: number | null;
    isCharging: boolean | null;
  } | null;
  signal: {
    id: string;
    requestedAt: string;
    ackedAt: string | null;
    status: SignalStatus;
  } | null;
}

export interface MyTrackPointDto {
  lat: number;
  lon: number;
  recordedAt: string;
  accuracy: number | null;
  speed: number | null;
}

export interface SignalResult {
  signalId: string;
  requestedAt: string;
  /** FCM принял сообщение. false — телефон получит сигнал при следующей выгрузке точек. */
  pushed: boolean;
}

function signalStatus(
  d: { signalRequestedAt: Date; signalAckedAt: Date | null },
  now: number,
): SignalStatus {
  if (d.signalAckedAt) {
    return now - d.signalAckedAt.getTime() < RING_DURATION_MS ? 'ringing' : 'done';
  }
  return now - d.signalRequestedAt.getTime() < SIGNAL_TTL_MS ? 'pending' : 'expired';
}

/**
 * v0.73.0 «Найти телефон» (docs/superpowers/specs/2026-10-09-find-parent-phone.md).
 *
 * Взрослый видит, вызывает звонок и переименовывает свои телефоны; v0.74.0 —
 * владелец семьи то же самое делает с телефонами всех взрослых своей семьи,
 * независимо от «Показывать меня семье».
 * Устройство — `ParentLocationDevice` (у него есть точки и батарея); push идёт
 * на FCM-токен, который присылает нативная служба этого же телефона.
 */
@Injectable()
export class FindPhoneService {
  private readonly logger = new Logger(FindPhoneService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FcmService) private readonly fcm: FcmService,
  ) {}

  async listMyPhones(userId: string): Promise<MyPhoneDto[]> {
    const found = await this.prisma.parentLocationDevice.findMany({
      where: await this.accessibleDevicesWhere(userId),
      include: { user: { select: { name: true, firstName: true, email: true } } },
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    if (found.length === 0) return [];
    // Свои сверху, внутри групп — порядок запроса (свежие первыми).
    const devices = [
      ...found.filter((d) => d.userId === userId),
      ...found.filter((d) => d.userId !== userId),
    ];

    const latestRows = await this.prisma.$queryRaw<
      Array<{
        deviceId: string;
        lat: number;
        lon: number;
        accuracy: number | null;
        recordedAt: Date;
        batteryLevel: number | null;
        isCharging: boolean | null;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (pl."deviceId")
             pl."deviceId", pl.lat, pl.lon, pl.accuracy, pl."recordedAt",
             pl."batteryLevel", pl."isCharging"
      FROM parent_locations pl
      WHERE pl."deviceId" IN (${Prisma.join(devices.map((d) => d.id))})
        AND pl."isMock" = false
      ORDER BY pl."deviceId", pl."recordedAt" DESC
    `);
    const latestByDevice = new Map(latestRows.map((r) => [r.deviceId, r]));

    const now = Date.now();
    return devices.map((d) => {
      const l = latestByDevice.get(d.id);
      return {
        id: d.id,
        deviceName: d.deviceName,
        customName: d.customName,
        isMine: d.userId === userId,
        ownerName: displayName(d.user),
        platform: d.platform,
        appVersion: d.appVersion,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        canPush: d.fcmToken !== null,
        latest: l
          ? {
              lat: l.lat,
              lon: l.lon,
              accuracy: l.accuracy,
              recordedAt: l.recordedAt.toISOString(),
              ageSec: Math.max(0, Math.floor((now - l.recordedAt.getTime()) / 1000)),
              batteryLevel: l.batteryLevel,
              isCharging: l.isCharging,
            }
          : null,
        signal:
          d.signalId && d.signalRequestedAt
            ? {
                id: d.signalId,
                requestedAt: d.signalRequestedAt.toISOString(),
                ackedAt: d.signalAckedAt?.toISOString() ?? null,
                status: signalStatus(
                  { signalRequestedAt: d.signalRequestedAt, signalAckedAt: d.signalAckedAt },
                  now,
                ),
              }
            : null,
      };
    });
  }

  async getMyTrack(
    userId: string,
    deviceId: string,
    fromIso: string,
    toIso: string,
  ): Promise<{ items: MyTrackPointDto[] }> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (!(from < to) || to.getTime() - from.getTime() > MAX_TRACK_SPAN_MS) {
      throw new BadRequestException({
        code: 'invalid_range',
        message: 'Range must be positive and at most 2 days',
      });
    }
    const device = await this.findAccessibleDevice(userId, deviceId);
    const floor = new Date(Date.now() - MAX_TRACK_AGE_MS);
    const rows = await this.prisma.parentLocation.findMany({
      where: {
        userId: device.userId,
        deviceId,
        isMock: false,
        recordedAt: { gte: from > floor ? from : floor, lt: to },
      },
      orderBy: { recordedAt: 'asc' },
      take: MAX_TRACK_POINTS,
      select: { lat: true, lon: true, recordedAt: true, accuracy: true, speed: true },
    });
    return {
      items: rows.map((r) => ({
        lat: r.lat,
        lon: r.lon,
        recordedAt: r.recordedAt.toISOString(),
        accuracy: r.accuracy,
        speed: r.speed,
      })),
    };
  }

  /**
   * Позвонить на телефон. Живой сигнал переиспользуется (двойной клик не
   * плодит команды), но push уходит заново — первый мог не доехать.
   */
  async requestSignal(userId: string, deviceId: string): Promise<SignalResult> {
    const device = await this.findAccessibleDevice(userId, deviceId);
    const now = new Date();
    let signalId: string;
    let requestedAt: Date;
    if (isSignalLive(device, now.getTime())) {
      signalId = device.signalId!;
      requestedAt = device.signalRequestedAt!;
    } else {
      signalId = createId();
      requestedAt = now;
      await this.prisma.parentLocationDevice.update({
        where: { id: device.id },
        data: { signalId, signalRequestedAt: requestedAt, signalAckedAt: null },
      });
    }

    let pushed = false;
    if (device.fcmToken) {
      const fcmToken = device.fcmToken;
      try {
        pushed = await this.fcm.sendHybridToToken({
          tokens: { fcmToken, rustorePushToken: null },
          data: { type: 'PLAY_SIGNAL', signalId },
          label: 'find-phone',
          priority: 'high',
          ttlSec: Math.floor(SIGNAL_TTL_MS / 1000),
          onInvalidFcmToken: async (t) => {
            await this.prisma.parentLocationDevice.updateMany({
              where: { id: device.id, fcmToken: t },
              data: { fcmToken: null },
            });
          },
        });
      } catch (err) {
        this.logger.warn(`find-phone push failed device=${device.id}: ${String(err)}`);
      }
    }
    this.logger.log(
      `find-phone signal=${signalId} by=${userId} owner=${device.userId} device=${device.id} pushed=${pushed}`,
    );
    return { signalId, requestedAt: requestedAt.toISOString(), pushed };
  }

  /** v0.74.0: своё имя телефона; null — снова показывать модель. */
  async renameDevice(
    userId: string,
    deviceId: string,
    name: string | null,
  ): Promise<{ id: string; customName: string | null }> {
    const device = await this.findAccessibleDevice(userId, deviceId);
    await this.prisma.parentLocationDevice.update({
      where: { id: device.id },
      data: { customName: name },
    });
    this.logger.log(`find-phone rename by=${userId} owner=${device.userId} device=${device.id}`);
    return { id: device.id, customName: name };
  }

  /** Телефон начал звонить. Чужой/старый signalId — no-op. */
  async ackSignal(ctx: ParentLocationAuthContext, signalId: string): Promise<{ ok: true }> {
    const updated = await this.prisma.parentLocationDevice.updateMany({
      where: { id: ctx.deviceId, signalId, signalAckedAt: null },
      data: { signalAckedAt: new Date() },
    });
    this.logger.log(
      `find-phone ack signal=${signalId} device=${ctx.deviceId} updated=${updated.count}`,
    );
    return { ok: true };
  }

  /**
   * Чьи телефоны доступны: свои + (v0.74.0) всех взрослых семей, где
   * `userId` — владелец. Ушедший из семьи участник выпадает сам: членства нет.
   */
  private async accessibleDevicesWhere(
    userId: string,
  ): Promise<Prisma.ParentLocationDeviceWhereInput> {
    const owned = await this.prisma.membership.findMany({
      where: { userId, role: 'owner', family: { deletedAt: null } },
      select: { familyId: true },
    });
    let userIds = [userId];
    if (owned.length > 0) {
      const members = await this.prisma.membership.findMany({
        where: { familyId: { in: owned.map((m) => m.familyId) } },
        select: { userId: true },
      });
      userIds = [...new Set([userId, ...members.map((m) => m.userId)])];
    }
    return { userId: { in: userIds }, revokedAt: null, user: { deletedAt: null } };
  }

  /** Чужое и недоступное — одинаково 404, чтобы не подтверждать существование. */
  private async findAccessibleDevice(userId: string, deviceId: string) {
    const device = await this.prisma.parentLocationDevice.findFirst({
      where: { id: deviceId, ...(await this.accessibleDevicesWhere(userId)) },
    });
    if (!device) {
      throw new NotFoundException({ code: 'device_not_found', message: 'Device not found' });
    }
    return device;
  }
}
