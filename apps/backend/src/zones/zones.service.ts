import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateZoneDto } from './dto/create-zone.schema';
import type { UpdateZoneDto } from './dto/update-zone.schema';
import type { ZoneDto } from './dto/zone.dto';
import type { ZoneEventDto } from './dto/zone-event.dto';
import type { ZonesEventsQuery } from './dto/zones-events-query.schema';
import { MAX_ZONES_PER_FAMILY } from './dto/constants';
import { initialInside } from './zone-detection.service';

interface ZoneRow {
  id: string;
  familyId: string;
  name: string;
  color: string;
  icon: string;
  centerLat: number;
  centerLon: number;
  radius: number;
  allChildren: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ZoneStateLite {
  childId: string;
  isInside: boolean;
}

interface ZoneGeometry {
  centerLat: number;
  centerLon: number;
  radius: number;
}

const ZONE_INCLUDE = {
  assignments: { select: { childId: true } },
  states: { select: { childId: true, isInside: true } },
} as const;

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
    allChildren: row.allChildren,
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

/** Курсор ленты — base64url от пары (recordedAt, id): порядок строго определён. */
export function encodeEventsCursor(recordedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([recordedAt.toISOString(), id])).toString('base64url');
}

export function decodeEventsCursor(cursor: string): { recordedAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [iso, id] = parsed as [unknown, unknown];
      const recordedAt = typeof iso === 'string' ? new Date(iso) : null;
      if (recordedAt && !Number.isNaN(recordedAt.getTime()) && typeof id === 'string' && id) {
        return { recordedAt, id };
      }
    }
  } catch {
    // ниже — единая ошибка
  }
  throw new BadRequestException({ code: 'invalid_cursor', message: 'Invalid cursor' });
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

    const explicitIds = dto.allChildren ? [] : dto.childIds;
    await this.assertChildrenInFamily(familyId, explicitIds);

    return this.prisma.$transaction(async (tx) => {
      const zone = await tx.zone.create({
        data: {
          familyId,
          name: dto.name,
          color: dto.color,
          icon: dto.icon,
          centerLat: dto.centerLat,
          centerLon: dto.centerLon,
          radius: dto.radius,
          allChildren: dto.allChildren,
          createdBy: userId,
        },
      });

      if (explicitIds.length > 0) {
        await tx.zoneChildAssignment.createMany({
          data: explicitIds.map((childId) => ({ zoneId: zone.id, childId })),
        });
      }

      // Начальное состояние — по последней хорошей точке, без события: иначе
      // ребёнок, уже стоящий внутри новой зоны, давал ложный «вход» с push.
      const targetIds = dto.allChildren ? await this.familyChildIds(tx, familyId) : explicitIds;
      const inside = await this.computeInitialInside(tx, zone, targetIds);
      if (targetIds.length > 0) {
        await tx.zoneState.createMany({
          data: targetIds.map((childId) => ({
            zoneId: zone.id,
            childId,
            isInside: inside.get(childId) ?? false,
          })),
        });
      }

      return toDto(
        zone,
        explicitIds,
        targetIds.map((childId) => ({ childId, isInside: inside.get(childId) ?? false })),
      );
    });
  }

  async list(familyId: string): Promise<ZoneDto[]> {
    const rows = await this.prisma.zone.findMany({
      where: { familyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: ZONE_INCLUDE,
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
      include: ZONE_INCLUDE,
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
      include: ZONE_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException({ code: 'zone_not_found', message: 'Zone not found' });
    }

    const currentIds = existing.assignments.map((a) => a.childId);
    const nextAll = dto.allChildren ?? existing.allChildren;
    // При «все дети» явных назначений нет; при снятии флага без childIds —
    // остаются прежние назначения (у зоны «для всех» их нет).
    const nextIds = nextAll ? [] : (dto.childIds ?? currentIds);
    const toAdd = nextIds.filter((id) => !currentIds.includes(id));
    const toRemove = currentIds.filter((id) => !nextIds.includes(id));
    await this.assertChildrenInFamily(familyId, toAdd);

    const geometry: ZoneGeometry = {
      centerLat: dto.centerLat ?? existing.centerLat,
      centerLon: dto.centerLon ?? existing.centerLon,
      radius: dto.radius ?? existing.radius,
    };
    const geometryChanged =
      geometry.centerLat !== existing.centerLat ||
      geometry.centerLon !== existing.centerLon ||
      geometry.radius !== existing.radius;

    return this.prisma.$transaction(async (tx) => {
      if (toRemove.length > 0) {
        await tx.zoneChildAssignment.deleteMany({ where: { zoneId, childId: { in: toRemove } } });
      }
      if (toAdd.length > 0) {
        await tx.zoneChildAssignment.createMany({
          data: toAdd.map((childId) => ({ zoneId, childId })),
        });
      }

      const scalarPatch: Prisma.ZoneUpdateInput = {};
      if (dto.name !== undefined) scalarPatch.name = dto.name;
      if (dto.color !== undefined) scalarPatch.color = dto.color;
      if (dto.icon !== undefined) scalarPatch.icon = dto.icon;
      if (dto.centerLat !== undefined) scalarPatch.centerLat = dto.centerLat;
      if (dto.centerLon !== undefined) scalarPatch.centerLon = dto.centerLon;
      if (dto.radius !== undefined) scalarPatch.radius = dto.radius;
      if (dto.allChildren !== undefined) scalarPatch.allChildren = dto.allChildren;
      await tx.zone.update({ where: { id: zoneId }, data: scalarPatch });

      // Состояния: убрать у тех, к кому зона больше не относится; новым детям
      // и всем при смене центра или радиуса — пересчёт по последней точке.
      const targetIds = nextAll ? await this.familyChildIds(tx, familyId) : nextIds;
      await tx.zoneState.deleteMany({ where: { zoneId, childId: { notIn: targetIds } } });
      const prevState = new Map(existing.states.map((s) => [s.childId, s.isInside]));
      const recomputeIds = geometryChanged
        ? targetIds
        : targetIds.filter((id) => !prevState.has(id));
      const inside = await this.computeInitialInside(tx, geometry, recomputeIds);
      for (const childId of recomputeIds) {
        const isInside = inside.get(childId) ?? false;
        const keepChange = prevState.get(childId) === isInside;
        await tx.zoneState.upsert({
          where: { zoneId_childId: { zoneId, childId } },
          create: { zoneId, childId, isInside },
          update: {
            isInside,
            pendingTransition: false,
            pendingSince: null,
            // Время входа сохраняем, только если состояние не изменилось.
            ...(keepChange ? {} : { lastConfirmedChange: null }),
          },
        });
      }

      const updated = await tx.zone.findUniqueOrThrow({
        where: { id: zoneId },
        include: ZONE_INCLUDE,
      });
      return toDto(
        updated,
        updated.assignments.map((a) => a.childId),
        updated.states,
      );
    });
  }

  async listEvents(
    familyId: string,
    q: ZonesEventsQuery,
  ): Promise<{ items: ZoneEventDto[]; nextCursor: string | null }> {
    // События удалённых (soft-delete) зон в ленте не показываем.
    const and: Prisma.ZoneEventWhereInput[] = [{ zone: { familyId, deletedAt: null } }];
    if (q.childId) and.push({ childId: q.childId });
    if (q.zoneId) and.push({ zoneId: q.zoneId });
    if (q.from) and.push({ recordedAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ recordedAt: { lte: new Date(q.to) } });
    if (q.cursor) {
      const c = decodeEventsCursor(q.cursor);
      // Строго после курсора в порядке (recordedAt desc, id desc): события с
      // одинаковым временем на границе страницы больше не теряются.
      and.push({
        OR: [{ recordedAt: { lt: c.recordedAt } }, { recordedAt: c.recordedAt, id: { lt: c.id } }],
      });
    }

    const rows = await this.prisma.zoneEvent.findMany({
      where: { AND: and },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: q.limit,
      include: {
        zone: { select: { name: true, color: true, icon: true } },
        child: { select: { name: true } },
      },
    });

    const items: ZoneEventDto[] = rows.map((row) => ({
      id: row.id,
      zoneId: row.zoneId,
      zoneName: row.zone.name,
      zoneColor: row.zone.color,
      zoneIcon: row.zone.icon,
      childId: row.childId,
      childName: row.child.name,
      type: row.type as 'entry' | 'exit',
      lat: row.lat,
      lon: row.lon,
      accuracy: row.accuracy ?? null,
      recordedAt: row.recordedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      durationSec: row.durationSec ?? null,
    }));

    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === q.limit && last ? encodeEventsCursor(last.recordedAt, last.id) : null;

    return { items, nextCursor };
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

  private async assertChildrenInFamily(familyId: string, childIds: string[]): Promise<void> {
    if (childIds.length === 0) return;
    const found = await this.prisma.child.findMany({
      where: { id: { in: childIds }, familyId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== childIds.length) {
      throw new NotFoundException({
        code: 'child_not_found',
        message: 'One or more children not found in this family',
      });
    }
  }

  private async familyChildIds(tx: Prisma.TransactionClient, familyId: string): Promise<string[]> {
    const rows = await tx.child.findMany({
      where: { familyId, deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * Внутри ли зоны каждый из детей по его последней хорошей точке (без
   * outlier и mock). Нет точек — ребёнка в карте нет (считаем «снаружи»).
   */
  private async computeInitialInside(
    tx: Prisma.TransactionClient,
    zone: ZoneGeometry,
    childIds: string[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (childIds.length === 0) return result;
    const rows = await tx.$queryRaw<
      Array<{ childId: string; accuracy: number | null; distance_m: number }>
    >(Prisma.sql`
      SELECT DISTINCT ON (l."childId")
             l."childId",
             l.accuracy,
             ST_Distance(
               ST_MakePoint(${zone.centerLon}, ${zone.centerLat})::geography,
               ST_MakePoint(l.lon, l.lat)::geography
             ) AS distance_m
      FROM locations l
      WHERE l."childId" IN (${Prisma.join(childIds)})
        AND (l."trackFlag" IS NULL OR l."trackFlag" NOT IN ('outlier', 'mock'))
      ORDER BY l."childId", l."recordedAt" DESC
    `);
    for (const r of rows) {
      result.set(r.childId, initialInside(Number(r.distance_m), r.accuracy, zone.radius));
    }
    return result;
  }
}
