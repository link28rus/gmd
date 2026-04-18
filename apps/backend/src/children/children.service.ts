import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateChildInput {
  name: string;
  dateOfBirth?: Date;
}

export interface UpdateChildInput {
  name?: string;
  dateOfBirth?: Date;
}

@Injectable()
export class ChildrenService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createChild(familyId: string, input: CreateChildInput) {
    return this.prisma.child.create({
      data: {
        familyId,
        name: input.name,
        dateOfBirth: input.dateOfBirth,
      },
    });
  }

  async listChildren(familyId: string): Promise<
    Array<{
      id: string;
      name: string;
      dateOfBirth: Date | null;
      device: {
        id: string;
        deviceName: string | null;
        osVersion: string | null;
        appVersion: string | null;
        lastSeenAt: Date | null;
        revokedAt: Date | null;
      } | null;
    }>
  > {
    type Row = {
      id: string;
      name: string;
      dateOfBirth: Date | null;
      device: {
        id: string;
        deviceName: string | null;
        osVersion: string | null;
        appVersion: string | null;
        lastSeenAt: Date | null;
        revokedAt: Date | null;
      } | null;
    };
    const rows = (await this.prisma.child.findMany({
      where: { familyId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { device: true },
    })) as Row[];
    return rows.map((c: Row) => ({
      id: c.id,
      name: c.name,
      dateOfBirth: c.dateOfBirth,
      device: c.device
        ? {
            id: c.device.id,
            deviceName: c.device.deviceName,
            osVersion: c.device.osVersion,
            appVersion: c.device.appVersion,
            lastSeenAt: c.device.lastSeenAt,
            revokedAt: c.device.revokedAt,
          }
        : null,
    }));
  }

  async getChildInFamily(familyId: string, childId: string) {
    return this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
    });
  }

  async updateChild(familyId: string, childId: string, patch: UpdateChildInput) {
    const existing = await this.getChildInFamily(familyId, childId);
    if (!existing) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    return this.prisma.child.update({
      where: { id: childId },
      data: { name: patch.name, dateOfBirth: patch.dateOfBirth },
    });
  }

  async softDelete(familyId: string, childId: string): Promise<void> {
    const existing = await this.getChildInFamily(familyId, childId);
    if (!existing) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.child.update({ where: { id: childId }, data: { deletedAt: now } }),
      this.prisma.childDevice.updateMany({
        where: { childId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.invite.updateMany({
        where: { childId, consumedAt: null },
        data: { consumedAt: now },
      }),
    ]);
  }
}
