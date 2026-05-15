import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AppBlockSchedule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import type { CreateScheduleBody, UpdateScheduleBody } from './dto/schedule.dto';

/**
 * Phase 6.x (v0.48) — расписание автоблокировки приложений.
 *
 * Дополняет AppBlockingService (разовые BlockSession): декларативные временные
 * окна «ПН–ПТ 22:00 → 08:00». На устройстве фактическая блокировка =
 * (active_session OR any_active_schedule) AND NOT (ALWAYS_ALLOWED OR HARDCODED).
 *
 * FCM: SYNC_SCHEDULES — child делает GET /child/schedules после получения
 * (по аналогии с SYNC_RULES).
 */
@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  // Лимит расписаний на ребёнка. 10 — с большим запасом (в реальности 2-3:
  // «Сон», «Школа», «Уроки»). Защищает от DoS / runaway-клиента.
  static readonly MAX_SCHEDULES_PER_DEVICE = 10;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FcmService) private readonly fcm: FcmService,
  ) {}

  // ─── parent-side ────────────────────────────────────────────────────────

  /**
   * Резолв активного устройства ребёнка. Если устройств несколько (history),
   * берём не-revoked (logic совпадает с AppBlockingService).
   */
  private async resolveDevice(
    childId: string,
  ): Promise<{ id: string; fcmToken: string | null; rustorePushToken: string | null }> {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: { id: true, fcmToken: true, rustorePushToken: true },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'no_active_device',
        message: 'Child has no active device',
      });
    }
    return device;
  }

  async listForChild(childId: string): Promise<AppBlockSchedule[]> {
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
      select: { id: true },
    });
    if (!device) return [];
    return this.prisma.appBlockSchedule.findMany({
      where: { childDeviceId: device.id },
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createForChild(params: {
    childId: string;
    createdByUserId: string;
    body: CreateScheduleBody;
  }): Promise<AppBlockSchedule> {
    const device = await this.resolveDevice(params.childId);

    const count = await this.prisma.appBlockSchedule.count({
      where: { childDeviceId: device.id },
    });
    if (count >= ScheduleService.MAX_SCHEDULES_PER_DEVICE) {
      throw new ForbiddenException({
        code: 'schedule_limit_reached',
        message: `Maximum ${ScheduleService.MAX_SCHEDULES_PER_DEVICE} schedules per child`,
      });
    }

    const schedule = await this.prisma.appBlockSchedule.create({
      data: {
        childDeviceId: device.id,
        createdByUserId: params.createdByUserId,
        name: params.body.name,
        daysMask: params.body.daysMask,
        startMin: params.body.startMin,
        endMin: params.body.endMin,
        enabled: params.body.enabled ?? true,
        mode: params.body.mode ?? 'BLOCK_NON_ALLOWED',
      },
    });

    this.notifyDevice(device.id, device.fcmToken, device.rustorePushToken, 'create');
    this.logger.log(
      `schedule created id=${schedule.id} child=${params.childId} mask=${params.body.daysMask} ${params.body.startMin}-${params.body.endMin}`,
    );
    return schedule;
  }

  async updateForChild(params: {
    childId: string;
    scheduleId: string;
    body: UpdateScheduleBody;
  }): Promise<AppBlockSchedule> {
    const existing = await this.findOwned(params.childId, params.scheduleId);

    const updated = await this.prisma.appBlockSchedule.update({
      where: { id: existing.id },
      data: {
        ...(params.body.name !== undefined ? { name: params.body.name } : {}),
        ...(params.body.daysMask !== undefined ? { daysMask: params.body.daysMask } : {}),
        ...(params.body.startMin !== undefined ? { startMin: params.body.startMin } : {}),
        ...(params.body.endMin !== undefined ? { endMin: params.body.endMin } : {}),
        ...(params.body.enabled !== undefined ? { enabled: params.body.enabled } : {}),
        ...(params.body.mode !== undefined ? { mode: params.body.mode } : {}),
      },
    });

    const device = await this.prisma.childDevice.findUnique({
      where: { id: existing.childDeviceId },
      select: { fcmToken: true, rustorePushToken: true },
    });
    this.notifyDevice(
      existing.childDeviceId,
      device?.fcmToken ?? null,
      device?.rustorePushToken ?? null,
      'update',
    );
    return updated;
  }

  async deleteForChild(params: { childId: string; scheduleId: string }): Promise<void> {
    const existing = await this.findOwned(params.childId, params.scheduleId);
    await this.prisma.appBlockSchedule.delete({ where: { id: existing.id } });

    const device = await this.prisma.childDevice.findUnique({
      where: { id: existing.childDeviceId },
      select: { fcmToken: true, rustorePushToken: true },
    });
    this.notifyDevice(
      existing.childDeviceId,
      device?.fcmToken ?? null,
      device?.rustorePushToken ?? null,
      'delete',
    );
  }

  // ─── child-side ─────────────────────────────────────────────────────────

  async listForDevice(childDeviceId: string): Promise<AppBlockSchedule[]> {
    return this.prisma.appBlockSchedule.findMany({
      where: { childDeviceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  /**
   * Проверка владения: расписание принадлежит активному устройству ребёнка
   * и ребёнок принадлежит family родителя (последнее проверяет контроллер
   * через assertChildInFamily; здесь — только schedule -> childDevice -> child).
   */
  private async findOwned(childId: string, scheduleId: string): Promise<AppBlockSchedule> {
    const schedule = await this.prisma.appBlockSchedule.findUnique({
      where: { id: scheduleId },
      include: { childDevice: { select: { childId: true } } },
    });
    if (!schedule) {
      throw new NotFoundException({
        code: 'schedule_not_found',
        message: 'Schedule not found',
      });
    }
    if (schedule.childDevice.childId !== childId) {
      // Защита от подмены childId в URL — расписание принадлежит другому ребёнку.
      throw new ForbiddenException({ code: 'schedule_belongs_to_other_child' });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { childDevice: _drop, ...pure } = schedule;
    return pure as AppBlockSchedule;
  }

  private notifyDevice(
    deviceId: string,
    fcmToken: string | null,
    rustorePushToken: string | null,
    op: string,
  ): void {
    void this.fcm
      .sendHybridDataMessage(deviceId, { fcmToken, rustorePushToken }, { type: 'SYNC_SCHEDULES' })
      .catch((err) =>
        this.logger.warn(`push SYNC_SCHEDULES (${op}) failed for ${deviceId}: ${String(err)}`),
      );
  }

  // ─── pure logic (для тестов и mobile-child-port) ────────────────────────

  /**
   * Активно ли расписание в момент `now` для ребёнка с TZ `tz`?
   *
   * Алгоритм:
   *   1. Получить локальное (в TZ ребёнка) ISO-weekday и минуты с полуночи.
   *   2. Прямое окно (startMin < endMin): попасть в [start, end) В нужный день.
   *   3. Cross-midnight (startMin > endMin):
   *      - Сегодня после startMin (день в маске сегодня) → активно.
   *      - Сегодня до endMin (день в маске ВЧЕРА — окно «продлено» с прошлого дня).
   *
   * @param schedule — модель расписания
   * @param now — момент времени (default = new Date())
   * @param tz — IANA timezone ребёнка (e.g. "Europe/Moscow")
   */
  static isActiveAt(
    schedule: Pick<AppBlockSchedule, 'enabled' | 'daysMask' | 'startMin' | 'endMin'>,
    now: Date,
    tz: string,
  ): boolean {
    if (!schedule.enabled) return false;
    if (schedule.startMin === schedule.endMin) return false; // защита от bad data

    const local = getLocalParts(now, tz);
    const todayBit = isoWeekdayBit(local.weekday);
    const yesterdayBit = isoWeekdayBit(local.weekday === 1 ? 7 : local.weekday - 1);

    if (schedule.startMin < schedule.endMin) {
      // прямое окно — только в день из маски
      return (
        (schedule.daysMask & todayBit) !== 0 &&
        local.minute >= schedule.startMin &&
        local.minute < schedule.endMin
      );
    }
    // cross-midnight: 22:00 → 08:00
    // (a) день в маске сегодня И minute >= startMin → активно сегодня после startMin
    // (b) день в маске вчера И minute < endMin → активно сегодня до endMin (хвост вчерашнего)
    const tailFromYesterday =
      (schedule.daysMask & yesterdayBit) !== 0 && local.minute < schedule.endMin;
    const headFromToday = (schedule.daysMask & todayBit) !== 0 && local.minute >= schedule.startMin;
    return tailFromYesterday || headFromToday;
  }
}

// ─── helpers (модульно-приватные) ─────────────────────────────────────────

interface LocalParts {
  /** ISO weekday: 1=ПН … 7=ВС */
  weekday: number;
  /** минуты с полуночи 0..1439 */
  minute: number;
}

/**
 * Получить локальные части (день недели + минута дня) в произвольной IANA-TZ.
 * Использует Intl.DateTimeFormat (доступно в Node 18+, в нашем NestJS-таргете
 * Node 20 — точно есть).
 *
 * Реализация через `formatToParts` — корректно для всех TZ включая
 * полуночные смещения (Asia/Kolkata UTC+05:30) и смены времени (DST).
 */
function getLocalParts(now: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  let weekdayStr = '';
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'weekday') weekdayStr = p.value;
    else if (p.type === 'hour') hour = Number.parseInt(p.value, 10) % 24;
    else if (p.type === 'minute') minute = Number.parseInt(p.value, 10);
  }
  return { weekday: weekdayShortToIso(weekdayStr), minute: hour * 60 + minute };
}

function weekdayShortToIso(s: string): number {
  switch (s) {
    case 'Mon':
      return 1;
    case 'Tue':
      return 2;
    case 'Wed':
      return 3;
    case 'Thu':
      return 4;
    case 'Fri':
      return 5;
    case 'Sat':
      return 6;
    case 'Sun':
      return 7;
    default:
      // fallback: используем UTC weekday если Intl вернул неизвестное (теоретически
      // не должно случиться).
      return 1;
  }
}

function isoWeekdayBit(weekday: number): number {
  return 1 << (weekday - 1);
}
