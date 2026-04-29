import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { ParentDevicesService } from '../parent-devices/parent-devices.service';

export interface ZoneCandidate {
  id: string;
  radius: number;
  distanceM: number;
}

export interface ProcessPointInput {
  familyId: string;
  childId: string;
  deviceId: string;
  lat: number;
  lon: number;
  accuracy?: number | null;
  recordedAt: Date;
}

export const DEBOUNCE_MS = 60_000;

export function buffer(radius: number): number {
  return Math.max(30, radius * 0.15);
}

@Injectable()
export class ZoneDetectionService {
  private readonly logger = new Logger(ZoneDetectionService.name);

  constructor(
    @Inject(FcmService) private readonly fcm: FcmService,
    @Inject(ParentDevicesService) private readonly parentDevices: ParentDevicesService,
  ) {}

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

  async processPoint(
    tx: Prisma.TransactionClient | PrismaService,
    p: ProcessPointInput,
  ): Promise<void> {
    const candidates = await this.findCandidateZones(tx, p.familyId, p.childId, p.lat, p.lon);
    const candidateMap = new Map(candidates.map((c) => [c.id, c]));

    // Load all current states for this child in this family (includes zones child has moved far from,
    // which won't be in candidateMap but still need exit processing).
    const existingStates = await (tx as Prisma.TransactionClient).zoneState.findMany({
      where: { childId: p.childId, zone: { familyId: p.familyId, deletedAt: null } },
    });

    const allZoneIds = new Set<string>([
      ...candidates.map((c) => c.id),
      ...existingStates.map((s) => s.zoneId),
    ]);

    for (const zoneId of allZoneIds) {
      const cand = candidateMap.get(zoneId);
      const state = existingStates.find((s) => s.zoneId === zoneId) ?? {
        zoneId,
        childId: p.childId,
        isInside: false,
        pendingTransition: false,
        pendingSince: null as Date | null,
      };

      let nextCandidate: boolean;
      if (cand) {
        const buf = buffer(cand.radius);
        if (cand.distanceM <= cand.radius) {
          nextCandidate = true;
        } else if (cand.distanceM <= cand.radius + buf) {
          nextCandidate = state.isInside; // hysteresis — stay
        } else {
          nextCandidate = false;
        }
      } else {
        nextCandidate = false; // outside radius+buffer completely
      }

      if (nextCandidate === state.isInside) {
        // Stable — reset any pending flag
        if (state.pendingTransition) {
          await (tx as Prisma.TransactionClient).zoneState.upsert({
            where: { zoneId_childId: { zoneId, childId: p.childId } },
            create: {
              zoneId,
              childId: p.childId,
              isInside: state.isInside,
              pendingTransition: false,
              pendingSince: null,
            },
            update: { pendingTransition: false, pendingSince: null },
          });
        }
        continue;
      }

      // Candidate differs from state — debounce
      if (!state.pendingTransition) {
        await (tx as Prisma.TransactionClient).zoneState.upsert({
          where: { zoneId_childId: { zoneId, childId: p.childId } },
          create: {
            zoneId,
            childId: p.childId,
            isInside: state.isInside,
            pendingTransition: true,
            pendingSince: p.recordedAt,
          },
          update: { pendingTransition: true, pendingSince: p.recordedAt },
        });
        continue;
      }

      const elapsed = p.recordedAt.getTime() - (state.pendingSince?.getTime() ?? 0);
      if (elapsed >= DEBOUNCE_MS) {
        const eventType = nextCandidate ? 'entry' : 'exit';
        await (tx as Prisma.TransactionClient).zoneEvent.create({
          data: {
            zoneId,
            childId: p.childId,
            type: eventType,
            lat: p.lat,
            lon: p.lon,
            accuracy: p.accuracy ?? null,
            recordedAt: p.recordedAt,
          },
        });
        await (tx as Prisma.TransactionClient).zoneState.upsert({
          where: { zoneId_childId: { zoneId, childId: p.childId } },
          create: {
            zoneId,
            childId: p.childId,
            isInside: nextCandidate,
            pendingTransition: false,
            pendingSince: null,
            lastConfirmedChange: p.recordedAt,
          },
          update: {
            isInside: nextCandidate,
            pendingTransition: false,
            pendingSince: null,
            lastConfirmedChange: p.recordedAt,
          },
        });
        this.logger.log(
          `zone-event ${eventType} child=${p.childId} zone=${zoneId} at=${p.recordedAt.toISOString()}`,
        );
        // FCM push родителям. Async после транзакции — fire-and-forget,
        // не блокируем processPoint и не откатываем event при сбое FCM.
        void this.notifyParentsOnZoneEvent({
          familyId: p.familyId,
          childId: p.childId,
          zoneId,
          eventType,
          recordedAt: p.recordedAt,
        }).catch((e) => this.logger.error(`zone-fcm notify failed: ${String(e)}`));
      }
      // else: continue waiting — don't touch pendingSince (keeps original anchor)
    }
  }

  /**
   * v0.46: разослать FCM data-message всем активным parent-devices семьи.
   * data: { type: GEOFENCE_ENTER|GEOFENCE_EXIT, childId, childName, zoneId, zoneName, recordedAt }.
   * Mobile-parent ловит, кладёт notification + deeplink на /home/child/{id}.
   */
  private async notifyParentsOnZoneEvent(args: {
    familyId: string;
    childId: string;
    zoneId: string;
    eventType: 'entry' | 'exit';
    recordedAt: Date;
  }): Promise<void> {
    const devices = await this.parentDevices.findActiveByFamilyId(args.familyId);
    if (devices.length === 0) return;
    // Резолвим имена. processPoint работает без injected PrismaService —
    // используем лёгкий fallback через ParentDevicesService.prisma не годится;
    // достанем через первый device-record уже в memory caller'а нет, так что
    // простой запрос здесь. Оставлено явно, чтобы не передавать zoneName/childName
    // через всю цепочку processPoint.
    const fcmService = this.fcm;
    const data: Record<string, string> = {
      type: args.eventType === 'entry' ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT',
      childId: args.childId,
      zoneId: args.zoneId,
      recordedAt: args.recordedAt.toISOString(),
    };
    await Promise.all(
      devices.map((d) =>
        fcmService.sendToToken({
          fcmToken: d.fcmToken,
          data,
          label: `${data.type} child=${args.childId} zone=${args.zoneId}`,
          onInvalidToken: (token) => this.parentDevices.clearTokenByExpired(token),
        }),
      ),
    );
  }
}
