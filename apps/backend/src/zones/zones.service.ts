import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateZoneDto } from './dto/create-zone.schema';
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
      if (found.length !== dto.childIds.length) {
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
}
