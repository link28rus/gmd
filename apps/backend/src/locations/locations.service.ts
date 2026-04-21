import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentService } from '../consent/consent.service';
import { ZoneDetectionService } from '../zones/zone-detection.service';
import type { ChildAuthContext } from '../child-device/child-device.service';
import type { LocationPoint } from './dto/ingest-locations.dto';
import type { ListLocationsQuery } from './dto/list-locations.dto';

export interface IngestResult {
  accepted: number;
  rejected: number;
  rejectedReasons: Record<string, number>;
}

export interface LocationDto {
  lat: number;
  lon: number;
  recordedAt: string;
  serverReceivedAt: string;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  bearing: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  provider: string | null;
  networkType: string | null;
  wifiSsid: string | null;
  mobileOperator: string | null;
}

function toDto(row: {
  lat: number;
  lon: number;
  recordedAt: Date;
  serverReceivedAt?: Date | null;
  accuracy?: number | null;
  altitude?: number | null;
  speed?: number | null;
  bearing?: number | null;
  batteryLevel?: number | null;
  isCharging?: boolean | null;
  provider?: string | null;
  networkType?: string | null;
  wifiSsid?: string | null;
  mobileOperator?: string | null;
}): LocationDto {
  return {
    lat: row.lat,
    lon: row.lon,
    recordedAt: row.recordedAt.toISOString(),
    serverReceivedAt: (row.serverReceivedAt ?? row.recordedAt).toISOString(),
    accuracy: row.accuracy ?? null,
    altitude: row.altitude ?? null,
    speed: row.speed ?? null,
    bearing: row.bearing ?? null,
    batteryLevel: row.batteryLevel ?? null,
    isCharging: row.isCharging ?? null,
    provider: row.provider ?? null,
    networkType: row.networkType ?? null,
    wifiSsid: row.wifiSsid ?? null,
    mobileOperator: row.mobileOperator ?? null,
  };
}

const OUT_OF_WINDOW_PAST_MS = 24 * 60 * 60 * 1000; // 24h
const OUT_OF_WINDOW_FUTURE_MS = 2 * 60 * 1000; // 2min
const CONSENT_CACHE_TTL_MS = 60 * 1000;

interface ConsentCacheEntry {
  expiresAt: number;
  ok: boolean;
}

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);
  // TODO(perf): cache is not concurrency-safe — N parallel cold-cache requests hit DB N times. Consider storing in-flight Promise.
  // TODO(memory): no eviction — entries accumulate for life of process. Safe at current scale; revisit in Phase 1.4.
  private readonly consentCache = new Map<string, ConsentCacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConsentService) private readonly consent: ConsentService,
    @Inject(ZoneDetectionService) private readonly zoneDetection: ZoneDetectionService,
  ) {}

  async ingestBatch(ctx: ChildAuthContext, points: LocationPoint[]): Promise<IngestResult> {
    const child = await this.prisma.child.findUnique({
      where: { id: ctx.childId },
      select: { id: true, familyId: true, deletedAt: true },
    });
    if (!child || child.deletedAt) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }

    const device = await this.prisma.childDevice.findUnique({
      where: { id: ctx.deviceId },
      select: { id: true, revokedAt: true },
    });
    if (!device || device.revokedAt) {
      throw new ForbiddenException({ code: 'device_revoked', message: 'Device revoked' });
    }

    const consentOk = await this.checkOwnerConsent(child.familyId, ctx.childId);
    if (!consentOk) {
      throw new HttpException(
        {
          code: 'consent_required',
          message: 'Owner must accept current privacy policy',
          currentPolicyVersion: this.consent.getCurrentVersion(),
        },
        HttpStatus.LOCKED,
      );
    }

    const rejectedReasons: Record<string, number> = {};
    const now = Date.now();
    const validPoints: LocationPoint[] = [];
    const validRows: Prisma.Sql[] = [];

    for (const p of points) {
      const ts = new Date(p.recordedAt).getTime();
      if (ts < now - OUT_OF_WINDOW_PAST_MS || ts > now + OUT_OF_WINDOW_FUTURE_MS) {
        rejectedReasons.out_of_window = (rejectedReasons.out_of_window ?? 0) + 1;
        continue;
      }
      validPoints.push(p);
      validRows.push(Prisma.sql`(
        ${createId()},
        ${ctx.childId},
        ${ctx.deviceId},
        ${p.lat},
        ${p.lon},
        ${p.accuracy ?? null},
        ${p.altitude ?? null},
        ${p.speed ?? null},
        ${p.bearing ?? null},
        ${p.batteryLevel ?? null},
        ${p.isCharging ?? null},
        ${p.provider ?? null},
        ${p.networkType ?? null},
        ${p.wifiSsid ?? null},
        ${p.mobileOperator ?? null},
        ${new Date(p.recordedAt)}
      )`);
    }

    let accepted = 0;
    if (validRows.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.$executeRaw(Prisma.sql`
          INSERT INTO "locations" (
            "id","childId","childDeviceId","lat","lon","accuracy","altitude","speed","bearing","batteryLevel","isCharging","provider","networkType","wifiSsid","mobileOperator","recordedAt"
          ) VALUES ${Prisma.join(validRows)}
          ON CONFLICT ("childDeviceId","recordedAt") DO NOTHING
        `);
        accepted = Number(inserted);
        const duplicates = validRows.length - accepted;
        if (duplicates > 0) {
          rejectedReasons.duplicate = (rejectedReasons.duplicate ?? 0) + duplicates;
        }

        // Zone detection for every valid (window-passed) point. Duplicates re-processed but
        // they deterministically produce the same state — safe no-op effectively.
        for (const p of validPoints) {
          await this.zoneDetection.processPoint(tx, {
            familyId: child.familyId,
            childId: ctx.childId,
            deviceId: ctx.deviceId,
            lat: p.lat,
            lon: p.lon,
            accuracy: p.accuracy ?? null,
            recordedAt: new Date(p.recordedAt),
          });
        }
      });
    }

    const rejected = points.length - accepted;

    this.logger.log(
      `ingest child=${ctx.childId} device=${ctx.deviceId} in=${points.length} accepted=${accepted} rejected=${rejected}`,
    );

    return { accepted, rejected, rejectedReasons };
  }

  async getLatest(childId: string): Promise<(LocationDto & { ageSec: number }) | null> {
    const row = await this.prisma.location.findFirst({
      where: { childId },
      orderBy: { recordedAt: 'desc' },
    });
    if (!row) return null;
    const ageSec = Math.floor((Date.now() - row.recordedAt.getTime()) / 1000);
    return { ...toDto(row), ageSec };
  }

  async list(
    childId: string,
    q: ListLocationsQuery,
  ): Promise<{ items: LocationDto[]; nextCursor: string | null }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { childId };
    if (q.from) where.recordedAt = { ...(where.recordedAt ?? {}), gte: new Date(q.from) };
    if (q.to) where.recordedAt = { ...(where.recordedAt ?? {}), lte: new Date(q.to) };
    if (q.cursor) {
      const op = q.order === 'desc' ? 'lt' : 'gt';
      where.recordedAt = { ...(where.recordedAt ?? {}), [op]: new Date(q.cursor) };
    }

    const rows = await this.prisma.location.findMany({
      where,
      orderBy: { recordedAt: q.order },
      take: q.limit,
    });
    const items = rows.map(toDto);
    const nextCursor =
      rows.length === q.limit ? rows[rows.length - 1].recordedAt.toISOString() : null;
    return { items, nextCursor };
  }

  private async checkOwnerConsent(familyId: string, childId: string): Promise<boolean> {
    const cached = this.consentCache.get(childId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.ok;

    const owner = await this.prisma.membership.findFirst({
      where: { familyId, role: 'owner' },
      select: { userId: true },
    });
    if (!owner) {
      this.consentCache.set(childId, { expiresAt: now + CONSENT_CACHE_TTL_MS, ok: false });
      return false;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: owner.userId },
      select: { acceptedPrivacyPolicyVersion: true },
    });
    const ok = !this.consent.userRequiresConsent(user?.acceptedPrivacyPolicyVersion ?? null);
    this.consentCache.set(childId, { expiresAt: now + CONSENT_CACHE_TTL_MS, ok });
    return ok;
  }

  // Invalidate cache (e.g., for e2e tests)
  clearConsentCache(): void {
    this.consentCache.clear();
  }
}
