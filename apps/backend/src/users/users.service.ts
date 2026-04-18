import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getMe(
    userId: string,
    familyId: string,
  ): Promise<{
    user: { id: string; email: string; name: string | null; locale: string };
    family: { id: string; name: string };
    memberships: Array<{ role: string; familyId: string }>;
  }> {
    const [user, memberships, family] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.membership.findMany({
        where: { userId },
        select: { role: true, familyId: true },
      }),
      this.prisma.family.findUnique({ where: { id: familyId } }),
    ]);
    if (!user || user.deletedAt || !family) {
      throw new NotFoundException({ code: 'not_found', message: 'User or family not found' });
    }
    return {
      user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
      family: { id: family.id, name: family.name },
      memberships,
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
