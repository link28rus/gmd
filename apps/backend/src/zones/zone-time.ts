import { ScheduleService } from '../app-control/schedule.service';

/** Местные части момента в IANA-поясе. weekday: 1 = ПН … 7 = ВС. */
export interface ZoneLocalParts {
  weekday: number;
  /** Минута дня 0..1439. */
  minute: number;
  /** Местная дата YYYY-MM-DD — ключ идемпотентности проверки «пришёл к сроку». */
  date: string;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zoneLocalParts(now: Date, tz: string): ZoneLocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number.parseInt(get('hour'), 10) % 24;
  return {
    weekday: WEEKDAYS[get('weekday')] ?? 1,
    minute: hour * 60 + Number.parseInt(get('minute'), 10),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export function dayBit(weekday: number): number {
  return 1 << (weekday - 1);
}

/**
 * Окно расписания уведомлений зоны активно в момент `at`. Логика общая с
 * расписаниями приложений (через полночь, маска дней) — ScheduleService.isActiveAt.
 */
export function isZoneScheduleActive(
  schedule: { daysMask: number; startMin: number; endMin: number },
  at: Date,
  tz: string,
): boolean {
  return ScheduleService.isActiveAt({ enabled: true, ...schedule }, at, tz);
}

/** "08:30" из минуты дня — для текстов push. */
export function formatMinute(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
