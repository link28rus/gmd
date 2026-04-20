import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SosEventDto {
  id: string;
  childId: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  serverCreatedAt: string;
  message: string | null;
  acknowledgedAt: string | null;
}

@Injectable()
export class FamilyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listFamilySos(userId: string, since?: Date): Promise<{ events: SosEventDto[] }> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { familyId: true },
    });
    const familyIds = memberships.map((m) => m.familyId);
    if (familyIds.length === 0) return { events: [] };
    const events = await this.prisma.sosEvent.findMany({
      where: {
        child: { familyId: { in: familyIds } },
        ...(since ? { serverCreatedAt: { gte: since } } : {}),
      },
      orderBy: { serverCreatedAt: 'desc' },
      take: 50,
    });
    return {
      events: events.map((e) => ({
        id: e.id,
        childId: e.childId,
        lat: e.lat,
        lon: e.lon,
        accuracy: e.accuracy,
        recordedAt: e.recordedAt.toISOString(),
        serverCreatedAt: e.serverCreatedAt.toISOString(),
        message: e.message,
        acknowledgedAt: e.acknowledgedAt ? e.acknowledgedAt.toISOString() : null,
      })),
    };
  }

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
