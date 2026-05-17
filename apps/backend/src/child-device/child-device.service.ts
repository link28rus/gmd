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

@Injectable()
export class ChildDeviceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConsentService) private readonly consent: ConsentService,
  ) {}

  async claim(rawCode: string, meta: ClaimMeta): Promise<ClaimResult> {
    const code = normalizeInviteCode(rawCode);

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
      // Multi-use invites автоматически revoke'ают activeDevice (поведение
      // для тест-инвайта модератора RuStore: каждая новая итерация модерации
      // получает свежее устройство, старая привязка снимается).
      // Single-use invites сохраняют прежний контракт: claim падает с
      // child_has_device если для ребёнка уже есть активное устройство.
      const activeDevice = await tx.childDevice.findFirst({
        where: { childId: invite.childId, revokedAt: null },
      });
      const maxUses = invite.maxUses ?? 1;
      const usesCount = invite.usesCount ?? 0;
      if (activeDevice) {
        if (maxUses <= 1) {
          throw new ConflictException({
            code: 'child_has_device',
            message: 'Child already has active device',
          });
        }
        await tx.childDevice.update({
          where: { id: activeDevice.id },
          data: { revokedAt: new Date() },
        });
      }
      // `ChildDevice.childId` имеет глобальный `@unique`, не partial — поэтому
      // старые revoked-записи (после /reset-device или multi-use auto-revoke)
      // остаются в индексе и валят следующий claim с P2002. Удаляем их до
      // create (cascade снесёт старые locations/sos — они уже привязаны к
      // revoked-устройству и не нужны новому claim'у).
      await tx.childDevice.deleteMany({
        where: { childId: invite.childId, revokedAt: { not: null } },
      });
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
      const newDevice = await tx.childDevice.create({
        data: {
          childId: invite.childId,
          tokenHash: sha256(token),
          deviceName: meta.deviceName,
          osVersion: meta.osVersion,
          appVersion: meta.appVersion,
        },
      });
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
        device: { id: newDevice.id },
        childAge,
        parentUserId: invite.createdBy,
        childId: child.id,
      };
    });

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
  //                    нужно self-destruct (Device Admin блокирует uninstall).
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
    if (!device) return { status: 'unknown' };
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
