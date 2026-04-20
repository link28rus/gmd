import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateZoneDto } from './dto/create-zone.schema';
import type { UpdateZoneDto } from './dto/update-zone.schema';
import type { ZoneDto } from './dto/zone.dto';
import { MAX_ZONES_PER_FAMILY } from './dto/constants';

interface ZoneRow {
  id: string;
  familyId: string;
  name: string;
  color: string;
  icon: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ZoneStateLite {
  childId: string;
  isInside: boolean;
}

function toDto(row: ZoneRow, childIds: string[], states?: ZoneStateLite[]): ZoneDto {
  const dto: ZoneDto = {
    id: row.id,
    familyId: row.familyId,
    name: row.name,
    color: row.color,
    icon: row.icon,
    centerLat: row.centerLat,
    centerLon: row.centerLon,
    radius: row.radius,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    childIds,
  };
  if (states) {
    dto.states = states.map((s) => ({ childId: s.childId, isInside: s.isInside }));
  }
  return dto;
}

@Injectable()
export class ZonesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(familyId: string, userId: string, dto: CreateZoneDto): Promise<ZoneDto> {
    const count = await this.prisma.zone.count({ where: { familyId, deletedAt: null } });
    if (count >= MAX_ZONES_PER_FAMILY) {
      throw new ConflictException({
        code: 'zone_limit_reached',
        message: `Zone limit reached (${MAX_ZONES_PER_FAMILY})`,
      });
    }

    if (dto.childIds.length > 0) {
      const found = await this.prisma.child.findMany({
        where: { id: { in: dto.childIds }, familyId, deletedAt: null },
        select: { id: true },
      });
      const foundIds = new Set(found.map((c) => c.id));
      const missing = dto.childIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new NotFoundException({
          code: 'child_not_found',
          message: 'One or more children not found in this family',
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.$transaction(async (tx: any) => {
      const zone = await tx.zone.create({
        data: {
          familyId,
          name: dto.name,
          color: dto.color,
          icon: dto.icon,
          centerLat: dto.centerLat,
          centerLon: dto.centerLon,
          radius: dto.radius,
          createdBy: userId,
        },
      });

      if (dto.childIds.length > 0) {
        await tx.zoneChildAssignment.createMany({
          data: dto.childIds.map((childId) => ({ zoneId: zone.id, childId })),
        });
        await tx.zoneState.createMany({
          data: dto.childIds.map((childId) => ({
            zoneId: zone.id,
            childId,
            isInside: false,
          })),
        });
      }

      return toDto(zone, dto.childIds);
    });
  }

  async list(familyId: string): Promise<ZoneDto[]> {
    const rows = await this.prisma.zone.findMany({
      where: { familyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        assignments: { select: { childId: true } },
        states: { select: { childId: true, isInside: true } },
      },
    });
    return rows.map((row) =>
      toDto(
        row,
        row.assignments.map((a) => a.childId),
        row.states,
      ),
    );
  }

  async get(familyId: string, zoneId: string): Promise<ZoneDto> {
    const row = await this.prisma.zone.findFirst({
      where: { id: zoneId, familyId, deletedAt: null },
      include: {
        assignments: { select: { childId: true } },
        states: { select: { childId: true, isInside: true } },
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
    }
    return toDto(
      row,
      row.assignments.map((a) => a.childId),
      row.states,
    );
  }

  async update(familyId: string, zoneId: string, dto: UpdateZoneDto): Promise<ZoneDto> {
    const existing = await this.prisma.zone.findFirst({
      where: { id: zoneId, familyId, deletedAt: null },
      include: { assignments: { select: { childId: true } } },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
    }

    let toAdd: string[] = [];
    let toRemove: string[] = [];
    if (dto.childIds) {
      const currentIds = existing.assignments.map((a) => a.childId);
      const nextIds = dto.childIds;
      toAdd = nextIds.filter((id) => !currentIds.includes(id));
      toRemove = currentIds.filter((id) => !nextIds.includes(id));

      if (toAdd.length > 0) {
        const found = await this.prisma.child.findMany({
          where: { id: { in: toAdd }, familyId, deletedAt: null },
          select: { id: true },
        });
        const foundIds = new Set(found.map((c) => c.id));
        const missing = toAdd.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          throw new NotFoundException({
            code: 'child_not_found',
            message: 'One or more children not found in this family',
          });
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.$transaction(async (tx: any) => {
      if (toRemove.length > 0) {
        await tx.zoneChildAssignment.deleteMany({
          where: { zoneId, childId: { in: toRemove } },
        });
        await tx.zoneState.deleteMany({
          where: { zoneId, childId: { in: toRemove } },
        });
      }
      if (toAdd.length > 0) {
        await tx.zoneChildAssignment.createMany({
          data: toAdd.map((childId) => ({ zoneId, childId })),
        });
        await tx.zoneState.createMany({
          data: toAdd.map((childId) => ({ zoneId, childId, isInside: false })),
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scalarPatch: Record<string, any> = {};
      if (dto.name !== undefined) scalarPatch.name = dto.name;
      if (dto.color !== undefined) scalarPatch.color = dto.color;
      if (dto.icon !== undefined) scalarPatch.icon = dto.icon;
      if (dto.centerLat !== undefined) scalarPatch.centerLat = dto.centerLat;
      if (dto.centerLon !== undefined) scalarPatch.centerLon = dto.centerLon;
      if (dto.radius !== undefined) scalarPatch.radius = dto.radius;

      const updated = await tx.zone.update({
        where: { id: zoneId },
        data: scalarPatch,
        include: {
          assignments: { select: { childId: true } },
          states: { select: { childId: true, isInside: true } },
        },
      });

      return toDto(
        updated,
        updated.assignments.map((a: { childId: string }) => a.childId),
        updated.states,
      );
    });
  }

  async softDelete(familyId: string, zoneId: string): Promise<void> {
    const existing = await this.prisma.zone.findFirst({
      where: { id: zoneId, familyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
    }
    await this.prisma.zone.update({
      where: { id: zoneId },
      data: { deletedAt: new Date() },
    });
  }
}
