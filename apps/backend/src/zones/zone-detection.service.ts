import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

// v0.59.0: событие по точке, записанной раньше этого срока, считаем
// запоздавшим — ребёнок был без сети, телефон отдал точки пачкой. Push
// всё равно шлём, но с флагом delayed: приложение родителя покажет реальное
// время события, а не «прямо сейчас».
export const LATE_EVENT_MS = 3 * 60_000;

/** Буфер выхода: снаружи — только дальше R + B от центра (с учётом погрешности). */
export function buffer(radius: number): number {
  return Math.max(30, radius * 0.15);
}

export type ZoneVerdict = 'inside' | 'outside' | null;

/**
 * v0.64.0: вердикт по одной точке с учётом погрешности (accuracy, метры).
 * Внутри — если d + acc/2 ≤ R; снаружи — если d − acc > R + B; иначе null
 * («неясно»): состояние не меняем и ожидание перехода не сбрасываем. Так
 * грубая ночная точка из квартиры не даёт ложного «ушёл из дома».
 */
export function classifyPoint(
  distanceM: number,
  accuracyM: number | null | undefined,
  radius: number,
): ZoneVerdict {
  const acc = accuracyM && accuracyM > 0 ? accuracyM : 0;
  if (distanceM + acc / 2 <= radius) return 'inside';
  if (distanceM - acc > radius + buffer(radius)) return 'outside';
  return null;
}

/**
 * Начальное состояние без события (создание зоны, правка центра или радиуса,
 * добавление ребёнка): однозначный вердикт по формуле, «неясно» — по d ≤ R.
 */
export function initialInside(
  distanceM: number,
  accuracyM: number | null | undefined,
  radius: number,
): boolean {
  const v = classifyPoint(distanceM, accuracyM, radius);
  return v === null ? distanceM <= radius : v === 'inside';
}

/** Подтверждённое событие зоны — push по нему уходит после commit транзакции. */
export interface ZoneEventNotice {
  familyId: string;
  childId: string;
  zoneId: string;
  eventType: 'entry' | 'exit';
  recordedAt: Date;
}

@Injectable()
export class ZoneDetectionService {
  private readonly logger = new Logger(ZoneDetectionService.name);

  constructor(
    @Inject(FcmService) private readonly fcm: FcmService,
    @Inject(ParentDevicesService) private readonly parentDevices: ParentDevicesService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Все зоны семьи, применимые к ребёнку (флаг «все дети» или назначение), с
   * расстоянием до точки. Зон в семье не больше 20, поэтому без ST_DWithin:
   * отсечение по R + B теряло точки с большой погрешностью, а формула буфера
   * жила в двух местах.
   */
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
        WHERE z."familyId" = ${familyId}
          AND z."deletedAt" IS NULL
          AND (
            z."allChildren"
            OR EXISTS (
              SELECT 1 FROM zone_child_assignments a
              WHERE a."zoneId" = z.id AND a."childId" = ${childId}
            )
          )
      `,
    );
    return rows.map((r) => ({ id: r.id, radius: r.radius, distanceM: Number(r.distance_m) }));
  }

  /**
   * Сериализует расчёт зон одного ребёнка: две пачки точек, пришедшие
   * одновременно, иначе читают одно и то же ZoneState и пишут вразнобой.
   * Блокировка снимается с концом транзакции.
   */
  async lockChild(tx: Prisma.TransactionClient, childId: string): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('zone-state'), hashtext(${childId}))::text`,
    );
  }

  /**
   * Обрабатывает одну точку. Возвращает подтверждённые события — push по ним
   * вызывающий шлёт ПОСЛЕ commit (notifyParents): раньше push уходил изнутри
   * транзакции, и откат давал push без события, а повтор запроса — дубль.
   */
  async processPoint(
    tx: Prisma.TransactionClient,
    p: ProcessPointInput,
  ): Promise<ZoneEventNotice[]> {
    const candidates = await this.findCandidateZones(tx, p.familyId, p.childId, p.lat, p.lon);
    if (candidates.length === 0) return [];

    const existingStates = await tx.zoneState.findMany({
      where: { childId: p.childId, zoneId: { in: candidates.map((c) => c.id) } },
    });
    const stateByZone = new Map(existingStates.map((s) => [s.zoneId, s]));
    const notices: ZoneEventNotice[] = [];

    for (const cand of candidates) {
      const zoneId = cand.id;
      const key = { zoneId_childId: { zoneId, childId: p.childId } };
      const verdict = classifyPoint(cand.distanceM, p.accuracy, cand.radius);
      const state = stateByZone.get(zoneId);

      // Неясно — ни состояние, ни ожидание перехода не трогаем (гистерезис).
      if (verdict === null) continue;
      const nextInside = verdict === 'inside';

      // Состояния нет (ребёнок появился в семье после создания зоны «для
      // всех»): первая однозначная точка молча задаёт состояние, без события.
      if (!state) {
        await tx.zoneState.upsert({
          where: key,
          create: { zoneId, childId: p.childId, isInside: nextInside },
          update: {},
        });
        continue;
      }

      if (nextInside === state.isInside) {
        if (state.pendingTransition) {
          await tx.zoneState.update({
            where: key,
            data: { pendingTransition: false, pendingSince: null },
          });
        }
        continue;
      }

      // Вердикт расходится с состоянием — ждём подтверждения DEBOUNCE_MS по
      // времени фикса. Якорь pendingSince не сдвигаем.
      if (!state.pendingTransition || !state.pendingSince) {
        await tx.zoneState.update({
          where: key,
          data: { pendingTransition: true, pendingSince: p.recordedAt },
        });
        continue;
      }
      if (p.recordedAt.getTime() - state.pendingSince.getTime() < DEBOUNCE_MS) continue;

      const eventType = nextInside ? 'entry' : 'exit';
      // Сколько пробыл в зоне — только если вход мы видели сами
      // (lastConfirmedChange ставит лишь подтверждённое событие).
      const durationSec =
        eventType === 'exit' && state.lastConfirmedChange
          ? Math.max(
              0,
              Math.round((p.recordedAt.getTime() - state.lastConfirmedChange.getTime()) / 1000),
            )
          : null;
      await tx.zoneEvent.create({
        data: {
          zoneId,
          childId: p.childId,
          type: eventType,
          lat: p.lat,
          lon: p.lon,
          accuracy: p.accuracy ?? null,
          recordedAt: p.recordedAt,
          durationSec,
        },
      });
      await tx.zoneState.update({
        where: key,
        data: {
          isInside: nextInside,
          pendingTransition: false,
          pendingSince: null,
          lastConfirmedChange: p.recordedAt,
        },
      });
      this.logger.log(
        `zone-event ${eventType} child=${p.childId} zone=${zoneId} at=${p.recordedAt.toISOString()}`,
      );
      notices.push({
        familyId: p.familyId,
        childId: p.childId,
        zoneId,
        eventType,
        recordedAt: p.recordedAt,
      });
    }
    return notices;
  }

  /** Разослать push по событиям — вызывать после commit транзакции приёма. */
  notifyParents(notices: ZoneEventNotice[]): void {
    for (const n of notices) {
      void this.notifyParentsOnZoneEvent(n).catch((e) =>
        this.logger.error(`zone-fcm notify failed: ${String(e)}`),
      );
    }
  }

  /**
   * v0.46: разослать FCM data-message всем активным parent-devices семьи.
   * data: { type: GEOFENCE_ENTER|GEOFENCE_EXIT, childId, childName, zoneId, zoneName, recordedAt }.
   * Mobile-parent ловит, кладёт notification + deeplink на /home/child/{id}.
   */
  private async notifyParentsOnZoneEvent(args: ZoneEventNotice): Promise<void> {
    const devices = await this.parentDevices.findActiveByFamilyId(args.familyId);
    if (devices.length === 0) return;
    // Резолвим имена ребёнка и зоны — без них родитель видит generic
    // «Ребёнок вошёл в одну из геозон» и не понимает, кто и куда.
    const [child, zone] = await Promise.all([
      this.prisma.child.findUnique({
        where: { id: args.childId },
        select: { name: true },
      }),
      this.prisma.zone.findUnique({
        where: { id: args.zoneId },
        select: { name: true },
      }),
    ]);
    const fcmService = this.fcm;
    const data: Record<string, string> = {
      type: args.eventType === 'entry' ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT',
      childId: args.childId,
      childName: child?.name ?? '',
      zoneId: args.zoneId,
      zoneName: zone?.name ?? '',
      recordedAt: args.recordedAt.toISOString(),
    };
    if (Date.now() - args.recordedAt.getTime() > LATE_EVENT_MS) {
      data.delayed = '1';
    }
    await Promise.all(
      devices.map((d) =>
        fcmService.sendHybridToToken({
          tokens: { fcmToken: d.fcmToken, rustorePushToken: d.rustorePushToken },
          data,
          label: `${data.type} child=${args.childId} zone=${args.zoneId}`,
          onInvalidFcmToken: (token) => this.parentDevices.clearTokenByExpired(token),
          onInvalidRustoreToken: (token) => this.parentDevices.clearRustoreByExpired(token),
        }),
      ),
    );
  }
}
