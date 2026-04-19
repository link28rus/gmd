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
import type { ChildAuthContext } from '../child-device/child-device.service';
import type { LocationPoint } from './dto/ingest-locations.dto';

export interface IngestResult {
  accepted: number;
  rejected: number;
  rejectedReasons: Record<string, number>;
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
  private readonly consentCache = new Map<string, ConsentCacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConsentService) private readonly consent: ConsentService,
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
    const validRows: Prisma.Sql[] = [];

    for (const p of points) {
      const ts = new Date(p.recordedAt).getTime();
      if (ts < now - OUT_OF_WINDOW_PAST_MS || ts > now + OUT_OF_WINDOW_FUTURE_MS) {
        rejectedReasons.out_of_window = (rejectedReasons.out_of_window ?? 0) + 1;
        continue;
      }
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
        ${new Date(p.recordedAt)}
      )`);
    }

    let accepted = 0;
    if (validRows.length > 0) {
      const inserted = await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO "locations" (
          "id","childId","childDeviceId","lat","lon","accuracy","altitude","speed","bearing","batteryLevel","isCharging","provider","recordedAt"
        ) VALUES ${Prisma.join(validRows)}
        ON CONFLICT ("childDeviceId","recordedAt") DO NOTHING
      `);
      accepted = Number(inserted);
      const duplicates = validRows.length - accepted;
      if (duplicates > 0) {
        rejectedReasons.duplicate = (rejectedReasons.duplicate ?? 0) + duplicates;
      }
    }

    const rejected = points.length - accepted;

    this.logger.log(
      `ingest child=${ctx.childId} device=${ctx.deviceId} in=${points.length} accepted=${accepted} rejected=${rejected}`,
    );

    return { accepted, rejected, rejectedReasons };
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
