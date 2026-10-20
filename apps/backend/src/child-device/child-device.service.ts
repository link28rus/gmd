import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeInviteCode } from '../invites/lib/code-generator';
import { computeAgeYears } from '../common/age';
import { ConsentService } from '../consent/consent.service';

export interface ClaimMeta {
  deviceName?: string;
  osVersion?: string;
  appVersion?: string;
  consent14Plus?: boolean;
  ip?: string;
  ua?: string;
}

export interface ClaimResult {
  deviceToken: string;
  child: { id: string; name: string; familyId: string };
  device: { id: string };
}

export interface ChildAuthContext {
  deviceId: string;
  childId: string;
  familyId: string;
  childName: string;
  familyName: string;
}

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

export const hashDeviceToken = sha256;

@Injectable()
export class ChildDeviceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConsentService) private readonly consent: ConsentService,
  ) {}

  async claim(rawCode: string, meta: ClaimMeta): Promise<ClaimResult> {
    const code = normalizeInviteCode(rawCode);

    const result = await this.claimTx(code, meta);

    // Record 14+ consent outside transaction (after device created successfully)
    if (result.childAge != null && result.childAge >= 14) {
      await this.consent.recordChildConsent(result.childId, result.parentUserId, meta.ip, meta.ua);
    }

    return {
      deviceToken: result.deviceToken,
      child: result.child,
      device: result.device,
    };
  }

  // Первая привязка ребёнка двумя приглашениями одновременно: записи
  // устройства ещё нет, блокировать FOR UPDATE нечего, вторая транзакция
  // падает на @unique(childId) — P2002 → 500. Отдаём child_has_device.
  private async claimTx(code: string, meta: ClaimMeta) {
    try {
      return await this.claimTxInner(code, meta);
    } catch (e) {
      if ((e as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException({
          code: 'child_has_device',
          message: 'Child already has active device',
        });
      }
      throw e;
    }
  }

  private claimTxInner(code: string, meta: ClaimMeta) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // v0.50.7: multi-use invites — claim допустим пока usesCount < maxUses
      // И consumedAt IS NULL. Для single-use (maxUses=1, default) условие
      // эквивалентно прежнему `consumedAt IS NULL`. Для multi-use (maxUses>1)
      // consumedAt ставится только когда usesCount достиг maxUses.
      const lockRows = (await tx.$queryRawUnsafe(
        `SELECT id FROM invites
         WHERE code = $1
           AND "consumedAt" IS NULL
           AND "expiresAt" > NOW()
           AND "usesCount" < "maxUses"
         FOR UPDATE`,
        code,
      )) as Array<{ id: string }>;
      if (lockRows.length === 0) {
        throw new BadRequestException({ code: 'invite_invalid', message: 'Invite invalid' });
      }
      const inviteId = lockRows[0].id;
      const invite = await tx.invite.findFirst({ where: { id: inviteId } });
      if (!invite) {
        throw new BadRequestException({ code: 'invite_invalid', message: 'Invite invalid' });
      }
      // Запись устройства у ребёнка одна (`childId @unique`) и переиспользуется
      // при каждой новой привязке: точки, SOS, поездки ссылаются на неё, и
      // история ребёнка переживает сброс или замену телефона (v0.85; раньше
      // старая запись удалялась вместе со всей историей). FOR UPDATE — два
      // одновременных claim на одного ребёнка идут по очереди.
      const deviceRows = (await tx.$queryRawUnsafe(
        `SELECT id FROM child_devices WHERE "childId" = $1 FOR UPDATE`,
        invite.childId,
      )) as Array<{ id: string }>;
      const existing =
        deviceRows.length > 0
          ? await tx.childDevice.findFirst({ where: { id: deviceRows[0].id } })
          : null;
      const maxUses = invite.maxUses ?? 1;
      const usesCount = invite.usesCount ?? 0;
      // Активное устройство заменяют только invite перепривязки (v0.85) и
      // multi-use (тест-инвайт модератора RuStore). Обычный одноразовый
      // invite по-прежнему падает с child_has_device.
      if (existing && existing.revokedAt === null && maxUses <= 1 && !invite.replaceDevice) {
        throw new ConflictException({
          code: 'child_has_device',
          message: 'Child already has active device',
        });
      }
      const child = await tx.child.findFirst({
        where: { id: invite.childId, deletedAt: null },
      });
      if (!child) {
        throw new BadRequestException({ code: 'invite_invalid', message: 'Invite invalid' });
      }

      // 14+ consent check. Приоритет: согласие, данное родителем при создании
      // invite (invite.consent14PlusGranted=true) — тогда телефон не обязан
      // передавать consent14Plus. Fallback — флаг из тела запроса (для
      // совместимости со старыми версиями клиента до v0.18.8).
      const childAge = child.dateOfBirth ? computeAgeYears(child.dateOfBirth, new Date()) : null;
      const consentGranted = invite.consent14PlusGranted || meta.consent14Plus === true;
      if (childAge != null && childAge >= 14 && !consentGranted) {
        throw new BadRequestException({
          code: 'consent14plus_required',
          message: 'Child aged 14+ requires consent14Plus flag',
        });
      }

      const token = randomBytes(32).toString('base64url');
      let deviceId: string;
      if (existing) {
        // Старый токен — в retired: живой старый телефон получит из
        // /child/auth-status `device_revoked` и снимет Device Admin. Push-токены,
        // часовой пояс и готовность микрофона принадлежали старому телефону.
        await tx.childDeviceRetiredToken.upsert({
          where: { tokenHash: existing.tokenHash },
          create: { tokenHash: existing.tokenHash, childDeviceId: existing.id },
          update: {},
        });
        await tx.childDevice.update({
          where: { id: existing.id },
          data: {
            tokenHash: sha256(token),
            deviceName: meta.deviceName ?? null,
            osVersion: meta.osVersion ?? null,
            appVersion: meta.appVersion ?? null,
            revokedAt: null,
            lastSeenAt: null,
            createdAt: new Date(),
            fcmToken: null,
            fcmTokenUpdatedAt: null,
            rustorePushToken: null,
            rustorePushTokenUpdatedAt: null,
            timezone: null,
            micReady: null,
            micReadyAt: null,
          },
        });
        // Неисполненные команды адресовались старому телефону — новый не
        // должен, например, подать сигнал при первом запуске.
        await tx.deviceCommand.updateMany({
          where: { childDeviceId: existing.id, status: 'pending' },
          data: { status: 'cancelled' },
        });
        deviceId = existing.id;
      } else {
        const created = await tx.childDevice.create({
          data: {
            childId: invite.childId,
            tokenHash: sha256(token),
            deviceName: meta.deviceName,
            osVersion: meta.osVersion,
            appVersion: meta.appVersion,
          },
        });
        deviceId = created.id;
      }
      const newUsesCount = usesCount + 1;
      await tx.invite.update({
        where: { id: invite.id },
        data: {
          usesCount: newUsesCount,
          // consumedAt — финальное состояние "больше нельзя claim'ить".
          // Ставим только когда фактически достигли maxUses (для multi-use)
          // ИЛИ при первом использовании single-use инвайта.
          consumedAt: newUsesCount >= maxUses ? new Date() : null,
        },
      });
      return {
        deviceToken: token,
        child: { id: child.id, name: child.name, familyId: child.familyId },
        device: { id: deviceId },
        childAge,
        parentUserId: invite.createdBy,
        childId: child.id,
      };
    });
  }

  // Короткий запрос protection-state для mobile-child: возвращает только
  // флаг, без истории. Mobile-child опрашивает при старте и далее периодически
  // (heartbeat 2 мин) — по результату решает активировать/деактивировать
  // DeviceAdmin.
  async getProtection(childId: string): Promise<{ enabled: boolean }> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, deletedAt: null },
      select: { protectionEnabled: true },
    });
    return { enabled: child?.protectionEnabled ?? false };
  }

  /**
   * Из переданных хэшей токенов — те, что всё ещё действуют (устройство не
   * отозвано, токен не заменён перепривязкой, ребёнок и семья не удалены).
   * Токен realtime-сокета проверяется только при подключении; шлюз
   * периодически сверяется, чтобы закрыть сокеты устройств, отвязанных или
   * заменённых уже после подключения.
   */
  async activeTokenHashes(hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) return new Set();
    const rows = await this.prisma.childDevice.findMany({
      where: {
        tokenHash: { in: hashes },
        revokedAt: null,
        child: { deletedAt: null, family: { deletedAt: null } },
      },
      select: { tokenHash: true },
    });
    return new Set(rows.map((r) => r.tokenHash));
  }

  async verifyToken(token: string): Promise<ChildAuthContext | null> {
    const tokenHash = sha256(token);
    const device = await this.prisma.childDevice.findFirst({
      where: { tokenHash, revokedAt: null },
    });
    if (!device) return null;
    const child = await this.prisma.child.findFirst({
      where: { id: device.childId, deletedAt: null },
      include: { family: { select: { name: true, deletedAt: true } } },
    });
    if (!child || child.family.deletedAt) return null;
    return {
      deviceId: device.id,
      childId: child.id,
      familyId: child.familyId,
      childName: child.name,
      familyName: child.family.name,
    };
  }

  // v0.38: escape hatch probe.
  // Возвращает явную причину, по которой токен может быть невалиден — нужно
  // mobile-child чтобы решить, делать ли self-destruct (removeActiveAdmin +
  // clear creds + cancel workers) или это просто временная сетевая проблема.
  //
  // 'active'         — токен живой, child не удалён, продолжаем как обычно.
  // 'device_revoked' — родитель сделал /reset-device → ChildDevice.revokedAt != null,
  //                    или привязал вместо этого телефона другой (токен в
  //                    retired) — нужно self-destruct (Device Admin блокирует uninstall).
  // 'child_deleted'  — родитель удалил ребёнка → Child.deletedAt != null,
  //                    нужно self-destruct.
  // 'unknown'        — токен никогда не существовал (фейковый/мусорный),
  //                    self-destruct НЕ нужен (это либо attacker, либо очень
  //                    старая install с stale token до миграции).
  async getAuthStatus(
    token: string,
  ): Promise<{ status: 'active' | 'device_revoked' | 'child_deleted' | 'unknown' }> {
    const tokenHash = sha256(token);
    const device = await this.prisma.childDevice.findFirst({
      where: { tokenHash },
      select: { id: true, childId: true, revokedAt: true },
    });
    if (!device) {
      // Токен телефона, вместо которого привязали другой (v0.85).
      const retired = await this.prisma.childDeviceRetiredToken.findUnique({
        where: { tokenHash },
        select: { tokenHash: true },
      });
      return { status: retired ? 'device_revoked' : 'unknown' };
    }
    if (device.revokedAt !== null) return { status: 'device_revoked' };
    const child = await this.prisma.child.findFirst({
      where: { id: device.childId },
      select: { id: true, deletedAt: true },
    });
    if (!child || child.deletedAt !== null) return { status: 'child_deleted' };
    return { status: 'active' };
  }

  touchLastSeen(deviceId: string): void {
    void this.prisma.childDevice
      .update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } })
      .catch(() => {
        /* ignore */
      });
  }

  // v0.57: версия приложения приходит в hello realtime-канала при каждом
  // подключении. Раньше appVersion писалась только при claim и после
  // самообновления оставалась старой.
  async setAppVersion(deviceId: string, appVersion: string): Promise<void> {
    await this.prisma.childDevice
      .update({ where: { id: deviceId }, data: { appVersion } })
      .catch(() => undefined);
  }

  // v0.62: готовность микрофона («Звук вокруг» запустится из фона) — из
  // realtime hello.micReady и {op:'status', micReady}. Условный UPDATE: строка
  // меняется только при смене значения (или с null), поэтому hello с тем же
  // значением не трогает micReadyAt и не создаёт лишнюю запись.
  async setMicReady(deviceId: string, micReady: boolean): Promise<boolean> {
    try {
      const res = await this.prisma.childDevice.updateMany({
        where: { id: deviceId, OR: [{ micReady: null }, { micReady: !micReady }] },
        data: { micReady, micReadyAt: new Date() },
      });
      return res.count > 0;
    } catch {
      return false;
    }
  }

  // v0.37: child регистрирует свой FCM token (или null если получил
  // INSTANCE_ID_RESET / устройство сменило). Backend хранит его в child_devices
  // и использует для high-priority push при createAudioSession (мгновенный
  // START_AUDIO вместо poll latency 60-120c).
  //
  // Идемпотентно: если token не изменился — обновляем только timestamp.
  // Если другой device уже привязал этот же token (UNIQUE constraint) — это
  // означает что Firebase переуступил token (редко, но возможно при reset).
  // В таком случае очищаем у старого device и привязываем к новому.
  async setFcmToken(deviceId: string, fcmToken: string | null): Promise<void> {
    if (fcmToken !== null) {
      // Очистить token у других устройств с таким же значением
      // (защита от UNIQUE constraint при FCM reset).
      await this.prisma.childDevice.updateMany({
        where: { fcmToken, NOT: { id: deviceId } },
        data: { fcmToken: null, fcmTokenUpdatedAt: new Date() },
      });
    }
    await this.prisma.childDevice.update({
      where: { id: deviceId },
      data: { fcmToken, fcmTokenUpdatedAt: new Date() },
    });
  }

  /**
   * v0.51 RuStore Push (lesson #24): аналогично setFcmToken, но для
   * rustorePushToken. Логика идентична — если приходит non-null, чистим
   * коллизии (UNIQUE), затем апдейтим текущее устройство.
   */
  async setRustorePushToken(deviceId: string, rustorePushToken: string | null): Promise<void> {
    if (rustorePushToken !== null) {
      await this.prisma.childDevice.updateMany({
        where: { rustorePushToken, NOT: { id: deviceId } },
        data: { rustorePushToken: null, rustorePushTokenUpdatedAt: new Date() },
      });
    }
    await this.prisma.childDevice.update({
      where: { id: deviceId },
      data: { rustorePushToken, rustorePushTokenUpdatedAt: new Date() },
    });
  }
}
