import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ZoneCandidate {
  id: string;
  radius: number;
  distanceM: number;
}

export const DEBOUNCE_MS = 60_000;

export function buffer(radius: number): number {
  return Math.max(30, radius * 0.15);
}

@Injectable()
export class ZoneDetectionService {
  private readonly logger = new Logger(ZoneDetectionService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findCandidateZones(
    tx: Prisma.TransactionClient | PrismaService,
    familyId: string,
    childId: string,
    lat: number,
    lon: number,
  ): Promise<ZoneCandidate[]> {
    const rows = await tx.$queryRaw<Array<{ id: string; radius: number; distance_m: number }>>(
      Prisma.sql`
        SELECT z.id,
               z.radius,
               ST_Distance(z.center_geo, ST_MakePoint(${lon}, ${lat})::geography) AS distance_m
        FROM zones z
        JOIN zone_child_assignments a ON a."zoneId" = z.id
        WHERE z."familyId" = ${familyId}
          AND a."childId" = ${childId}
          AND z."deletedAt" IS NULL
          AND ST_DWithin(
            z.center_geo,
            ST_MakePoint(${lon}, ${lat})::geography,
            z.radius + GREATEST(30, z.radius * 0.15)
          )
      `,
    );
    return rows.map((r) => ({ id: r.id, radius: r.radius, distanceM: Number(r.distance_m) }));
  }
}
