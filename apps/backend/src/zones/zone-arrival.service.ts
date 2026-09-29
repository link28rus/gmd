import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ZoneDetectionService } from './zone-detection.service';
import type { ZoneEventNotice } from './zone-detection.service';
import { dayBit, zoneLocalParts } from './zone-time';

export const ARRIVAL_TICK_MS = 60_000;
/** Окно догоняния после срока + запаса: рестарт backend не теряет проверку. */
export const ARRIVAL_CATCHUP_MIN = 120;
/** Последняя точка старше — телефон «молчит», вердикт «нет данных». */
export const ARRIVAL_STALE_MS = 20 * 60_000;

export type ArrivalVerdict = 'arrived' | 'missed' | 'no_data';

/**
 * v0.65.0: «не пришёл к сроку». Раз в минуту проверяет зоны со сроком: к
 * сроку + запасу ребёнок должен быть в зоне (или войти в неё за местные сутки
 * до срока). Иначе — событие missed_arrival (свежие данные) или no_data
 * (телефон молчит): «нет данных» — не то же, что «не пришёл».
 *
 * Идемпотентность — уникальный ключ (зона, ребёнок, местная дата) в
 * zone_arrival_checks; второй экземпляр или наложившийся тик отсекает
 * pg_try_advisory_xact_lock. Push — после commit.
 */
@Injectable()
export class ZoneArrivalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZoneArrivalService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ZoneDetectionService) private readonly detection: ZoneDetectionService,
  ) {}

  onModuleInit(): void {
    // В тестах тик вызывается явно — фоновый интервал мешал бы подсчётам.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.tick(new Date()).catch((e: unknown) =>
        this.logger.error(`arrival tick failed: ${String(e)}`),
      );
    }, ARRIVAL_TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date): Promise<ZoneEventNotice[]> {
    const notices = await this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext('zone-arrival-tick')) AS locked`,
      );
      if (!lock?.locked) return [];

      const zones = await tx.zone.findMany({
        where: {
          deletedAt: null,
          timezone: { not: null },
          arrivalDeadlineMin: { not: null },
          arrivalDaysMask: { not: null },
        },
        include: {
          assignments: { select: { childId: true } },
          states: { select: { childId: true, isInside: true, pendingTransition: true } },
        },
      });

      const out: ZoneEventNotice[] = [];
      for (const zone of zones) {
        const tz = zone.timezone as string;
        const deadline = zone.arrivalDeadlineMin as number;
        const local = zoneLocalParts(now, tz);
        if (((zone.arrivalDaysMask as number) & dayBit(local.weekday)) === 0) continue;
        const dueMin = deadline + zone.arrivalGraceMin;
        if (local.minute < dueMin || local.minute >= dueMin + ARRIVAL_CATCHUP_MIN) continue;

        // Начало местных суток и момент «срок + запас» — от текущего момента.
        const dayStart = new Date(
          now.getTime() -
            local.minute * 60_000 -
            now.getUTCSeconds() * 1000 -
            now.getUTCMilliseconds(),
        );
        const dueAt = new Date(dayStart.getTime() + dueMin * 60_000);

        // Дети зоны с живым устройством: без приложения проверять нечего.
        const children = await tx.child.findMany({
          where: {
            familyId: zone.familyId,
            deletedAt: null,
            ...(zone.allChildren ? {} : { id: { in: zone.assignments.map((a) => a.childId) } }),
            device: { is: { revokedAt: null } },
          },
          select: { id: true },
        });
        if (children.length === 0) continue;

        const done = await tx.zoneArrivalCheck.findMany({
          where: {
            zoneId: zone.id,
            localDate: local.date,
            childId: { in: children.map((c) => c.id) },
          },
          select: { childId: true },
        });
        const doneIds = new Set(done.map((d) => d.childId));

        for (const { id: childId } of children) {
          if (doneIds.has(childId)) continue;
          const st = zone.states.find((s) => s.childId === childId);
          // Внутри или ожидание входа (подтвердится через минуту) — пришёл.
          let arrived = !!st && (st.isInside || st.pendingTransition);
          if (!arrived) {
            const entry = await tx.zoneEvent.findFirst({
              where: {
                zoneId: zone.id,
                childId,
                type: 'entry',
                recordedAt: { gte: dayStart, lte: dueAt },
              },
              select: { id: true },
            });
            arrived = entry !== null;
          }
          const last = arrived
            ? null
            : await tx.location.findFirst({
                where: {
                  childId,
                  OR: [{ trackFlag: null }, { trackFlag: { notIn: ['outlier', 'mock'] } }],
                },
                orderBy: { recordedAt: 'desc' },
                select: { lat: true, lon: true, accuracy: true, recordedAt: true },
              });
          const verdict: ArrivalVerdict = arrived
            ? 'arrived'
            : last && now.getTime() - last.recordedAt.getTime() <= ARRIVAL_STALE_MS
              ? 'missed'
              : 'no_data';

          const inserted = await tx.zoneArrivalCheck.createMany({
            data: [{ zoneId: zone.id, childId, localDate: local.date, verdict }],
            skipDuplicates: true,
          });
          if (inserted.count === 0 || verdict === 'arrived') continue;

          const eventType = verdict === 'missed' ? 'missed_arrival' : 'no_data';
          await tx.zoneEvent.create({
            data: {
              zoneId: zone.id,
              childId,
              type: eventType,
              lat: last?.lat ?? zone.centerLat,
              lon: last?.lon ?? zone.centerLon,
              accuracy: last?.accuracy ?? null,
              recordedAt: now,
            },
          });
          this.logger.log(`zone-arrival ${eventType} child=${childId} zone=${zone.id}`);
          out.push({
            familyId: zone.familyId,
            childId,
            zoneId: zone.id,
            eventType,
            recordedAt: now,
          });
        }
      }
      return out;
    });
    this.detection.notifyParents(notices);
    return notices;
  }
}
