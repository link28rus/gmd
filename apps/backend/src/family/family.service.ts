import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FamilyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async rename(
    userId: string,
    familyId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    const family = await this.prisma.family.findUnique({ where: { id: familyId } });
    if (!family || family.deletedAt) {
      throw new NotFoundException({ code: 'not_found', message: 'Family not found' });
    }
    const m = await this.prisma.membership.findFirst({ where: { userId, familyId } });
    if (!m || m.role !== 'owner') {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'Only owner can rename family',
      });
    }
    const updated = await this.prisma.family.update({
      where: { id: familyId },
      data: { name },
    });
    return { id: updated.id, name: updated.name };
  }
}
