import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeInviteCode } from '../invites/lib/code-generator';
import { computeAgeYears } from '../common/age';
import { ConsentService } from '../consent/consent.service';
import { PinService } from '../auth/pin.service';

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
}

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

@Injectable()
export class ChildDeviceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(PinService) private readonly pin: PinService,
  ) {}

  async claim(rawCode: string, meta: ClaimMeta): Promise<ClaimResult> {
    const code = normalizeInviteCode(rawCode);

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const lockRows = (await tx.$queryRawUnsafe(
        `SELECT id FROM invites WHERE code = $1 AND "consumedAt" IS NULL AND "expiresAt" > NOW() FOR UPDATE`,
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
      const activeDevice = await tx.childDevice.findFirst({
        where: { childId: invite.childId, revokedAt: null },
      });
      if (activeDevice) {
        throw new ConflictException({
          code: 'child_has_device',
          message: 'Child already has active device',
        });
      }
      // `ChildDevice.childId` имеет глобальный `@unique`, не partial — поэтому
      // старые revoked-записи (после /reset-device) остаются в индексе и
      // валят следующий claim с P2002. Удаляем их до create (cascade снесёт
      // старые locations/sos — они уже привязаны к revoked-устройству и
      // не нужны новому claim'у).
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
      await tx.invite.update({
        where: { id: invite.id },
        data: { consumedAt: new Date() },
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

  // L2 PIN-lock: ребёнок в момент попытки деактивации Device Admin вводит PIN,
  // AccessibilityService отправляет сюда. Проверяем PIN против хешей ВСЕХ
  // родителей в семье (в семье могут быть несколько — любой из них валиден).
  // Rate-limit per-childDevice, чтобы подбор на одном устройстве не сказывался
  // на нормальном login у родителей.
  async verifyParentPin(params: {
    deviceId: string;
    childId: string;
    familyId: string;
    pin: string;
  }): Promise<{ ok: true }> {
    const lockKey = `child-device:${params.deviceId}`;
    const lock = await this.pin.isLocked(lockKey);
    if (lock.locked) {
      throw new HttpException(
        {
          code: 'pin_locked',
          message: 'Too many failed attempts',
          retryAfterSec: lock.retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const parents = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        pinHash: { not: null },
        memberships: { some: { familyId: params.familyId } },
      },
      select: { id: true, pinHash: true },
    });

    if (parents.length === 0) {
      // Ни у одного родителя семьи нет PIN — на устройстве ребёнка защиту
      // всё равно выключить нельзя (некем верифицировать). Сигнал для UI.
      throw new UnauthorizedException({
        code: 'no_parent_pin',
        message: 'No parent in family has PIN set',
      });
    }

    for (const parent of parents) {
      if (parent.pinHash && (await this.pin.verify(parent.pinHash, params.pin))) {
        await this.pin.clearFailures(lockKey);
        return { ok: true };
      }
    }

    const status = await this.pin.recordFailure(lockKey);
    throw new HttpException(
      {
        code: status.locked ? 'pin_locked' : 'invalid_pin',
        message: status.locked ? 'Too many failed attempts' : 'Invalid PIN',
        retryAfterSec: status.retryAfterSec,
      },
      status.locked ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.UNAUTHORIZED,
    );
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
    });
    if (!child) return null;
    return {
      deviceId: device.id,
      childId: child.id,
      familyId: child.familyId,
      childName: child.name,
    };
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
}
