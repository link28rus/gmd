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
      const child = await tx.child.findFirst({
        where: { id: invite.childId, deletedAt: null },
      });
      if (!child) {
        throw new BadRequestException({ code: 'invite_invalid', message: 'Invite invalid' });
      }

      // 14+ consent check
      const childAge = child.dateOfBirth ? computeAgeYears(child.dateOfBirth, new Date()) : null;
      if (childAge != null && childAge >= 14 && meta.consent14Plus !== true) {
        throw new BadRequestException({
          code: 'consent14plus_required',
          message: 'Child aged 14+ requires consent14Plus flag',
        });
      }

      const token = randomBytes(32).toString('base64url');
      await tx.childDevice.create({
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
    };
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
}
