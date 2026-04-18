import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_CONFIG } from '../admin/admin.tokens';
import type { AdminConfig } from '../admin/admin.tokens';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ADMIN_CONFIG) private readonly adminCfg: AdminConfig,
  ) {}

  async getMe(
    userId: string,
    familyId: string,
  ): Promise<{
    user: { id: string; email: string; name: string | null; locale: string };
    family: { id: string; name: string };
    memberships: Array<{ role: string; familyId: string }>;
    children: Array<{
      id: string;
      name: string;
      dateOfBirth: Date | null;
      device: { id: string; deviceName: string | null } | null;
    }>;
    isAdmin: boolean;
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
    const isAdmin = this.adminCfg.emails.includes(user.email.toLowerCase().trim());

    return {
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
      family: { id: family.id, name: family.name },
      memberships,
      children: children.map((c: ChildRow) => ({
        id: c.id,
        name: c.name,
        dateOfBirth: c.dateOfBirth,
        device: c.device ? { id: c.device.id, deviceName: c.device.deviceName } : null,
      })),
      isAdmin,
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

  async softDelete(userId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}
