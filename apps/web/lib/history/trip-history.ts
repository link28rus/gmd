// apps/web/lib/history/trip-history.ts
// Чистая логика экрана «История передвижений»: группировка поездок по дням,
// цвета, подписи времени/расстояния и привязка точек к геозонам.
import type { TripDto } from '@/lib/api/locations';
import type { Zone } from '@/lib/api/zones';
import { haversineMeters } from '@/lib/geo/track-gaps';

/**
 * Цвета поездок внутри дня — одни и те же в списке, на ленте суток и на
 * карте. Насыщенные, читаются и на светлых OSM-тайлах, и под CSS-фильтром
 * тёмной темы. Синий первым — как трек на главной карте.
 */
export const TRIP_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'];

export interface DayTrip {
  trip: TripDto;
  /** Номер поездки за день по порядку, с 1. */
  ordinal: number;
  color: string;
}

export interface TripDay {
  /** Локальная дата «YYYY-MM-DD». */
  key: string;
  /** Локальная полночь дня. */
  date: Date;
  /** Поездки по времени начала, утро сверху. */
  trips: DayTrip[];
  distanceM: number;
  movingMs: number;
}

const DAY_MS = 24 * 60 * 60_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function tripEndMs(trip: TripDto, nowMs: number = Date.now()): number {
  return trip.endedAt ? new Date(trip.endedAt).getTime() : nowMs;
}

/** Дни, новые сверху. Поездка через полночь относится к дню старта. */
export function groupTripsByDay(trips: TripDto[], nowMs: number = Date.now()): TripDay[] {
  const byKey = new Map<string, TripDto[]>();
  for (const t of trips) {
    const key = dayKeyOf(new Date(t.startedAt));
    const list = byKey.get(key);
    if (list) list.push(t);
    else byKey.set(key, [t]);
  }
  const days: TripDay[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    days.push({
      key,
      date: startOfDay(new Date(list[0].startedAt)),
      trips: list.map((trip, i) => ({
        trip,
        ordinal: i + 1,
        color: TRIP_COLORS[i % TRIP_COLORS.length],
      })),
      distanceM: list.reduce((s, t) => s + t.distanceM, 0),
      movingMs: list.reduce(
        (s, t) => s + Math.max(0, tripEndMs(t, nowMs) - new Date(t.startedAt).getTime()),
        0,
      ),
    });
  }
  return days.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Положение поездки на ленте суток: доли [0..1] от начала дня. */
export function ribbonSpan(
  trip: TripDto,
  dayStart: Date,
  nowMs: number = Date.now(),
): { left: number; width: number } {
  const base = dayStart.getTime();
  const from = Math.min(1, Math.max(0, (new Date(trip.startedAt).getTime() - base) / DAY_MS));
  const to = Math.min(1, Math.max(from, (tripEndMs(trip, nowMs) - base) / DAY_MS));
  return { left: from, width: to - from };
}

const WEEKDAYS = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];
const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** «Сегодня» / «Вчера» / «Понедельник» + «9 октября». */
export function dayTitle(date: Date, now: Date = new Date()): { title: string; date: string } {
  const diffDays = Math.round((startOfDay(now).getTime() - date.getTime()) / DAY_MS);
  const title = diffDays === 0 ? 'Сегодня' : diffDays === 1 ? 'Вчера' : WEEKDAYS[date.getDay()];
  const year = date.getFullYear() !== now.getFullYear() ? ` ${date.getFullYear()}` : '';
  return { title, date: `${date.getDate()} ${MONTHS_GEN[date.getMonth()]}${year}` };
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDurationMs(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest > 0 ? `${h} ч ${rest} мин` : `${h} ч`;
}

export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} м`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} км`;
}

/** Средняя скорость в км/ч; null — поездка слишком короткая, чтобы считать. */
export function avgSpeedKmh(distanceM: number, durationMs: number): number | null {
  if (durationMs < 60_000 || distanceM < 50) return null;
  return Math.round(distanceM / 1000 / (durationMs / 3_600_000));
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Запас к радиусу зоны: GPS на старте/финише часто «гуляет» на десятки метров. */
const ZONE_SLACK_M = 30;

/**
 * Геозона, в которой находится точка. Из пересекающихся берём самую
 * маленькую — она точнее описывает место («Школа» внутри «Район»).
 */
export function zoneAt(zones: Zone[], lat: number, lon: number): Zone | null {
  let best: Zone | null = null;
  for (const z of zones) {
    const d = haversineMeters({ lat, lon }, { lat: z.centerLat, lon: z.centerLon });
    if (d <= z.radius + ZONE_SLACK_M && (!best || z.radius < best.radius)) best = z;
  }
  return best;
}
