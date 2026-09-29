import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { ParentDevicesService } from '../parent-devices/parent-devices.service';
import { formatMinute, isZoneScheduleActive } from './zone-time';

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
  /** v0.65.0: + missed_arrival / no_data — от проверки «пришёл к сроку». */
  eventType: 'entry' | 'exit' | 'missed_arrival' | 'no_data';
  recordedAt: Date;
}

const PUSH_TYPE: Record<ZoneEventNotice['eventType'], string> = {
  entry: 'GEOFENCE_ENTER',
  exit: 'GEOFENCE_EXIT',
  missed_arrival: 'GEOFENCE_MISSED',
  no_data: 'GEOFENCE_NO_DATA',
};

// Канал событий в приложении родителя (ParentFirebaseMessagingService.CHANNEL_EVENTS).
const PARENT_EVENTS_CHANNEL = 'periscop_parent_events';

/** С этой версии APK родителя сам рисует GEOFENCE_MISSED / GEOFENCE_NO_DATA. */
export const PARENT_NATIVE_ZONE_PUSH_VERSION = [0, 66, 0] as const;

/**
 * v0.66.0: нужен ли мост — видимое уведомление FCM. Новым APK он вреден:
 * в фоне Android рисует уведомление сам и onMessageReceived не вызывается.
 * Версия неизвестна (старые регистрации) — считаем старым приложением.
 */
export function needsNotificationBridge(appVersion: string | null | undefined): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(appVersion ?? '');
  if (!m) return true;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i] !== PARENT_NATIVE_ZONE_PUSH_VERSION[i])
      return v[i] < PARENT_NATIVE_ZONE_PUSH_VERSION[i];
  }
  return false;
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
   * Разослать push о событии зоны активным устройствам родителей семьи.
   * v0.65.0: учитываются личные настройки каждого родителя (зона × ребёнок) и
   * расписание зоны (вне окна — push о приходе/уходе не шлём, событие в ленте
   * остаётся). data: { type, childId, childName, zoneId, zoneName, recordedAt,
   * delayed?, deadline? }.
   */
  private async notifyParentsOnZoneEvent(args: ZoneEventNotice): Promise<void> {
    const devices = await this.parentDevices.findActiveByFamilyId(args.familyId);
    if (devices.length === 0) return;
    // Резолвим имена ребёнка и зоны — без них родитель видит generic
    // «Ребёнок вошёл в одну из геозон» и не понимает, кто и куда.
    const [child, zone, prefs] = await Promise.all([
      this.prisma.child.findUnique({ where: { id: args.childId }, select: { name: true } }),
      this.prisma.zone.findUnique({
        where: { id: args.zoneId },
        select: {
          name: true,
          timezone: true,
          scheduleDaysMask: true,
          scheduleStartMin: true,
          scheduleEndMin: true,
          arrivalDeadlineMin: true,
        },
      }),
      this.prisma.zoneNotificationPref.findMany({
        where: { zoneId: args.zoneId, childId: args.childId },
      }),
    ]);
    const isMove = args.eventType === 'entry' || args.eventType === 'exit';
    if (
      isMove &&
      zone?.timezone &&
      zone.scheduleDaysMask !== null &&
      zone.scheduleStartMin !== null &&
      zone.scheduleEndMin !== null &&
      !isZoneScheduleActive(
        {
          daysMask: zone.scheduleDaysMask,
          startMin: zone.scheduleStartMin,
          endMin: zone.scheduleEndMin,
        },
        args.recordedAt,
        zone.timezone,
      )
    ) {
      this.logger.log(`zone push skipped: outside schedule zone=${args.zoneId}`);
      return;
    }

    const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
    const wants = (userId: string): boolean => {
      const p = prefByUser.get(userId);
      if (!p) return true; // нет строки — всё включено
      if (args.eventType === 'entry') return p.onEntry;
      if (args.eventType === 'exit') return p.onExit;
      return p.onMissedArrival;
    };
    const targets = devices.filter((d) => wants(d.userId));
    if (targets.length === 0) return;

    const childName = child?.name ?? '';
    const zoneName = zone?.name ?? '';
    const data: Record<string, string> = {
      type: PUSH_TYPE[args.eventType],
      childId: args.childId,
      childName,
      zoneId: args.zoneId,
      zoneName,
      recordedAt: args.recordedAt.toISOString(),
    };
    if (isMove && Date.now() - args.recordedAt.getTime() > LATE_EVENT_MS) {
      data.delayed = '1';
    }
    // Новые типы текущий APK родителя не рисует — мост до этапа 3: видимое
    // уведомление FCM, которое Android покажет сам, пока приложение свёрнуто.
    let notification: { title: string; body: string; channelId: string } | undefined;
    if (!isMove) {
      const deadline =
        zone?.arrivalDeadlineMin !== null && zone?.arrivalDeadlineMin !== undefined
          ? formatMinute(zone.arrivalDeadlineMin)
          : null;
      if (deadline) data.deadline = deadline;
      const who = childName || 'Ребёнок';
      const where = zoneName ? `«${zoneName}»` : 'зону';
      notification =
        args.eventType === 'missed_arrival'
          ? {
              title: `${who}: не в зоне ${where}`,
              body: `${who} не пришёл(а) в ${where}${deadline ? ` к ${deadline}` : ' к сроку'}.`,
              channelId: PARENT_EVENTS_CHANNEL,
            }
          : {
              title: `${who}: нет данных к сроку`,
              body: `Телефон не присылал местоположение — не знаем, пришёл(а) ли ${who} в ${where}${deadline ? ` к ${deadline}` : ''}.`,
              channelId: PARENT_EVENTS_CHANNEL,
            };
    }
    await Promise.all(
      targets.map((d) =>
        this.fcm.sendHybridToToken({
          tokens: { fcmToken: d.fcmToken, rustorePushToken: d.rustorePushToken },
          data,
          notification:
            notification && needsNotificationBridge(d.appVersion) ? notification : undefined,
          label: `${data.type} child=${args.childId} zone=${args.zoneId}`,
          onInvalidFcmToken: (token) => this.parentDevices.clearTokenByExpired(token),
          onInvalidRustoreToken: (token) => this.parentDevices.clearRustoreByExpired(token),
        }),
      ),
    );
  }
}
