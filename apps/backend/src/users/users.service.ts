import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_CONFIG } from '../admin/admin.tokens';
import type { AdminConfig } from '../admin/admin.tokens';
import { ConsentService } from '../consent/consent.service';
import { StaleTokenService } from '../auth/stale-token.service';
import { detachUserFromFamilies } from '../family/family-lifecycle';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ADMIN_CONFIG) private readonly adminCfg: AdminConfig,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Optional() @Inject(StaleTokenService) private readonly stale?: StaleTokenService,
  ) {}

  async getMe(
    userId: string,
    familyId: string,
  ): Promise<{
    user: {
      id: string;
      email: string;
      name: string | null;
      locale: string;
      acceptedPrivacyPolicyVersion: string | null;
    };
    family: { id: string; name: string };
    memberships: Array<{ role: string; familyId: string }>;
    children: Array<{
      id: string;
      name: string;
      dateOfBirth: Date | null;
      device: { id: string; deviceName: string | null } | null;
    }>;
    isAdmin: boolean;
    hasPassword: boolean;
    requiresConsent: boolean;
    currentPolicyVersion: string;
  }> {
    type ChildRow = {
      id: string;
      name: string;
      dateOfBirth: Date | null;
      device: { id: string; deviceName: string | null } | null;
    };
    const [user, memberships, family, childrenRaw] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.membership.findMany({
        where: { userId },
        select: { role: true, familyId: true },
      }),
      this.prisma.family.findUnique({ where: { id: familyId } }),
      this.prisma.child.findMany({
        where: { familyId, deletedAt: null },
        include: {
          device: { select: { id: true, deviceName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const children = childrenRaw as ChildRow[];
    if (!user || user.deletedAt || !family) {
      throw new NotFoundException({ code: 'not_found', message: 'User or family not found' });
    }
    // isAdmin = role=admin в БД, либо email в env-fallback. Env-fallback
    // остаётся для emergency-доступа если админ случайно снял с себя права.
    const isAdmin =
      user.role === 'admin' || this.adminCfg.emails.includes(user.email.toLowerCase().trim());
    const hasPassword = Boolean(user.passwordHash);
    const requiresConsent = this.consent.userRequiresConsent(user.acceptedPrivacyPolicyVersion);
    const currentPolicyVersion = this.consent.getCurrentVersion();

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        acceptedPrivacyPolicyVersion: user.acceptedPrivacyPolicyVersion,
      },
      family: { id: family.id, name: family.name },
      memberships,
      children: children.map((c: ChildRow) => ({
        id: c.id,
        name: c.name,
        dateOfBirth: c.dateOfBirth,
        device: c.device ? { id: c.device.id, deviceName: c.device.deviceName } : null,
      })),
      isAdmin,
      hasPassword,
      requiresConsent,
      currentPolicyVersion,
    };
  }

  async updateMe(
    userId: string,
    patch: { name?: string; locale?: string },
  ): Promise<{ id: string; email: string; name: string | null; locale: string }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: patch.name, locale: patch.locale },
    });
    return { id: user.id, email: user.email, name: user.name, locale: user.locale };
  }

  /**
   * DELETE /me. v0.71.0: человек уходит и из семьи — владелец с другими
   * взрослыми передаёт права самому раннему, один в семье — семья в soft-delete
   * (раньше членство оставалось, и удалённый продолжал получать push семьи).
   */
  async softDelete(userId: string): Promise<void> {
    const now = new Date();
    const heirs = await this.prisma.$transaction(async (tx) => {
      const h = await detachUserFromFamilies(tx, userId, now);
      await tx.user.update({ where: { id: userId }, data: { deletedAt: now } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return h;
    });
    await this.stale?.markStale([userId, ...heirs]);
  }
}
