import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { ChildRealtimeService } from '../child-realtime/child-realtime.service';
import { normalizeDiagConfig } from './diag-config';
import type { DiagConfig } from './diag-config';
import type { DiagConfigDto, UploadDiagLogDto } from './dto/diag.dto';

/** Запрос журнала ждёт телефон сутки: не на связи — уйдёт при подключении. */
export const DIAG_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
/** Хранение журналов — 14 дней. */
export const DIAG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** Не больше 30 журналов на устройство. */
export const DIAG_MAX_UPLOADS_PER_DEVICE = 30;
/** Сколько журналов показывать в админке. */
const ADMIN_LIST_LIMIT = 30;

export interface ChildDiagView {
  device: {
    id: string;
    appVersion: string | null;
    lastSeenAt: string | null;
    online: boolean;
  } | null;
  config: DiagConfig;
  pendingRequest: { commandId: string; createdAt: string; expiresAt: string } | null;
  uploads: Array<{
    id: string;
    reason: string;
    trigger: string | null;
    appVersion: string | null;
    sizeBytes: number;
    createdAt: string;
  }>;
}

export interface DiagUploadView {
  id: string;
  childId: string;
  reason: string;
  trigger: string | null;
  commandId: string | null;
  appVersion: string | null;
  sizeBytes: number;
  createdAt: string;
  snapshot: string | null;
  log: string | null;
  logcat: string | null;
}

/**
 * v0.60: журнал приложения ребёнка на сервере
 * (docs/superpowers/specs/2026-09-29-child-diag-logs.md).
 *
 * - Настройки (DiagConfig) — состояние устройства, не команда: лежат в
 *   `child_devices.diagConfig` и уходят телефону `DIAG_CONFIG` по мгновенному
 *   каналу при каждом подключении и сразу после изменения.
 * - Запрос журнала — команда `UPLOAD_DIAG` в `device_commands` (TTL 24 ч);
 *   досылка при подключении — DeviceCommandsService.replayPendingOverRealtime.
 * - Журналы видит только администратор.
 */
@Injectable()
export class DiagService implements OnModuleInit {
  private readonly logger = new Logger(DiagService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FcmService) private readonly fcm: FcmService,
    @Inject(ChildRealtimeService) private readonly realtime: ChildRealtimeService,
  ) {}

  onModuleInit(): void {
    // На тот же колбэк подписан и DeviceCommandsService (досылка команд):
    // сообщения у sendWithAck независимы, порядок не важен.
    this.realtime.onDeviceConnected((deviceId) => {
      void this.pushConfigOnConnect(deviceId).catch((err) =>
        this.logger.warn(`DIAG_CONFIG on connect for ${deviceId} failed: ${String(err)}`),
      );
    });
  }

  /** Телефон подключился к мгновенному каналу — отдаём ему текущие настройки. */
  async pushConfigOnConnect(deviceId: string): Promise<boolean> {
    const device = await this.prisma.childDevice.findUnique({
      where: { id: deviceId },
      select: { diagConfig: true, revokedAt: true },
    });
    if (!device || device.revokedAt) return false;
    return this.sendConfig(deviceId, normalizeDiagConfig(device.diagConfig));
  }

  // ─── телефон ──────────────────────────────────────────────────────────

  async getConfigForDevice(deviceId: string): Promise<DiagConfig> {
    const device = await this.prisma.childDevice.findUnique({
      where: { id: deviceId },
      select: { diagConfig: true },
    });
    return normalizeDiagConfig(device?.diagConfig ?? null);
  }

  async saveUpload(
    ctx: { deviceId: string; childId: string },
    dto: UploadDiagLogDto,
  ): Promise<{ id: string }> {
    const commandId = dto.commandId || null;
    const sizeBytes = [dto.snapshot, dto.log, dto.logcat].reduce(
      (sum, s) => sum + (s ? Buffer.byteLength(s, 'utf8') : 0),
      0,
    );
    const row = await this.prisma.diagLogUpload.create({
      data: {
        childDeviceId: ctx.deviceId,
        childId: ctx.childId,
        reason: dto.reason,
        trigger: dto.trigger,
        commandId,
        appVersion: dto.appVersion,
        sizeBytes,
        snapshot: dto.snapshot,
        log: dto.log,
        logcat: dto.logcat,
      },
      select: { id: true },
    });
    this.logger.log(
      `diag upload ${row.id}: device=${ctx.deviceId} reason=${dto.reason}` +
        `${dto.trigger ? ` trigger=${dto.trigger}` : ''} size=${sizeBytes}`,
    );

    if (commandId) {
      // Только UPLOAD_DIAG этого же устройства: телефон не может этим
      // запросом «закрыть» чужую или другую команду.
      await this.prisma.deviceCommand
        .updateMany({
          where: {
            id: commandId,
            childDeviceId: ctx.deviceId,
            type: 'UPLOAD_DIAG',
            status: 'pending',
          },
          data: { status: 'executed', executedAt: new Date() },
        })
        .catch((err) => this.logger.warn(`mark executed ${commandId}: ${String(err)}`));
    }

    // Ретеншн не должен ронять загрузку: журнал уже сохранён.
    await this.applyRetention(ctx.deviceId).catch((err) =>
      this.logger.warn(`diag retention for ${ctx.deviceId} failed: ${String(err)}`),
    );
    return { id: row.id };
  }

  /**
   * Удаляет журналы старше 14 дней (всех устройств — у кого-то новых
   * загрузок может больше не быть) и всё сверх 30 последних у устройства.
   * Возвращает число удалённых записей.
   */
  async applyRetention(deviceId: string, now = new Date()): Promise<number> {
    const expired = await this.prisma.diagLogUpload.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - DIAG_RETENTION_MS) } },
    });
    const overflow = await this.prisma.diagLogUpload.findMany({
      where: { childDeviceId: deviceId },
      orderBy: { createdAt: 'desc' },
      skip: DIAG_MAX_UPLOADS_PER_DEVICE,
      select: { id: true },
    });
    let removed = expired.count;
    if (overflow.length > 0) {
      const res = await this.prisma.diagLogUpload.deleteMany({
        where: { id: { in: overflow.map((u) => u.id) } },
      });
      removed += res.count;
    }
    return removed;
  }

  // ─── администратор ────────────────────────────────────────────────────

  async getChildDiag(childId: string): Promise<ChildDiagView> {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: { id: true },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    const device = await this.findActiveDevice(childId);
    const pending = device ? await this.findPendingRequest(device.id) : null;
    const uploads = await this.prisma.diagLogUpload.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
      take: ADMIN_LIST_LIMIT,
      select: {
        id: true,
        reason: true,
        trigger: true,
        appVersion: true,
        sizeBytes: true,
        createdAt: true,
      },
    });
    return {
      device: device
        ? {
            id: device.id,
            appVersion: device.appVersion,
            lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
            online: this.realtime.isConnected(device.id),
          }
        : null,
      config: normalizeDiagConfig(device?.diagConfig ?? null),
      pendingRequest: pending
        ? {
            commandId: pending.id,
            createdAt: pending.createdAt.toISOString(),
            expiresAt: pending.expiresAt.toISOString(),
          }
        : null,
      uploads: uploads.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    };
  }

  async updateConfig(
    childId: string,
    dto: DiagConfigDto,
  ): Promise<{ config: DiagConfig; delivered: boolean }> {
    const device = await this.requireActiveDevice(childId);
    const config = normalizeDiagConfig(dto);
    await this.prisma.childDevice.update({
      where: { id: device.id },
      data: { diagConfig: config as unknown as Prisma.InputJsonValue },
    });
    // Не на связи — не страшно: настройки уйдут при подключении
    // (pushConfigOnConnect) и через GET /child/diag/config.
    const delivered = await this.sendConfig(device.id, config).catch((err) => {
      this.logger.warn(`DIAG_CONFIG to ${device.id} failed: ${String(err)}`);
      return false;
    });
    return { config, delivered };
  }

  async requestUpload(
    childId: string,
    createdByUserId: string,
  ): Promise<{ commandId: string; delivered: boolean; expiresAt: string }> {
    const device = await this.requireActiveDevice(childId);

    // Живой запрос уже есть — не плодим очередь, но толкаем ещё раз:
    // первый push мог не доехать.
    let cmd = await this.findPendingRequest(device.id);
    if (!cmd) {
      cmd = await this.prisma.deviceCommand.create({
        data: {
          childDeviceId: device.id,
          type: 'UPLOAD_DIAG',
          status: 'pending',
          createdByUserId,
          expiresAt: new Date(Date.now() + DIAG_REQUEST_TTL_MS),
        },
      });
    }

    // Сначала мгновенный канал (ack помечает команду выполненной), затем
    // RuStore/FCM. Не доставили — команда ждёт в очереди до подключения.
    const delivered = await this.fcm
      .sendHybridDataMessage(
        device.id,
        { fcmToken: device.fcmToken, rustorePushToken: device.rustorePushToken },
        { type: 'UPLOAD_DIAG', commandId: cmd.id },
      )
      .catch((err) => {
        this.logger.warn(`push UPLOAD_DIAG ${cmd.id} failed: ${String(err)}`);
        return false;
      });
    return { commandId: cmd.id, delivered, expiresAt: cmd.expiresAt.toISOString() };
  }

  async getUpload(uploadId: string): Promise<DiagUploadView> {
    const u = await this.prisma.diagLogUpload.findUnique({ where: { id: uploadId } });
    if (!u) {
      throw new NotFoundException({ code: 'upload_not_found', message: 'Upload not found' });
    }
    return {
      id: u.id,
      childId: u.childId,
      reason: u.reason,
      trigger: u.trigger,
      commandId: u.commandId,
      appVersion: u.appVersion,
      sizeBytes: u.sizeBytes,
      createdAt: u.createdAt.toISOString(),
      snapshot: u.snapshot,
      log: u.log,
      logcat: u.logcat,
    };
  }

  async deleteUpload(uploadId: string): Promise<void> {
    const res = await this.prisma.diagLogUpload.deleteMany({ where: { id: uploadId } });
    if (res.count === 0) {
      throw new NotFoundException({ code: 'upload_not_found', message: 'Upload not found' });
    }
  }

  // ─── внутреннее ───────────────────────────────────────────────────────

  private sendConfig(deviceId: string, config: DiagConfig): Promise<boolean> {
    return this.realtime.sendWithAck(deviceId, {
      type: 'DIAG_CONFIG',
      config: JSON.stringify(config),
    });
  }

  private findActiveDevice(childId: string) {
    return this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: {
        id: true,
        appVersion: true,
        lastSeenAt: true,
        diagConfig: true,
        fcmToken: true,
        rustorePushToken: true,
      },
    });
  }

  private async requireActiveDevice(childId: string) {
    const device = await this.findActiveDevice(childId);
    if (!device) {
      throw new NotFoundException({
        code: 'no_active_device',
        message: 'Child has no active device',
      });
    }
    return device;
  }

  private findPendingRequest(deviceId: string) {
    return this.prisma.deviceCommand.findFirst({
      where: {
        childDeviceId: deviceId,
        type: 'UPLOAD_DIAG',
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
