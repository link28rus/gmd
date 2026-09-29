// apps/web/app/cabinet/zones/components/zone-format.ts
// Общие форматтеры и ключи localStorage страницы геозон.

export const ZONE_ICON_EMOJI: Record<string, string> = {
  home: '🏠',
  school: '🏫',
  sport: '⚽',
  art: '🎨',
  hospital: '🏥',
  shop: '🏪',
  music: '🎵',
  other: '📍',
};

/** 5400 → «1 ч 30 мин», 90000 → «1 д 1 ч», 40 → «меньше минуты». */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return 'меньше минуты';
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  if (hours < 24) return restMin ? `${hours} ч ${restMin} мин` : `${hours} ч`;
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return restH ? `${days} д ${restH} ч` : `${days} д`;
}

/** Русское склонение: plural(3, 'ночь', 'ночи', 'ночей') → «ночи». */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Ключ календарного дня в локальном часовом поясе браузера. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** «Сегодня», «Вчера», «12 сентября», «12 сентября 2025». */
export function dayLabel(d: Date, now: Date = new Date()): string {
  const today = localDayKey(now);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const key = localDayKey(d);
  if (key === today) return 'Сегодня';
  if (key === localDayKey(y)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatClock(d: Date): string {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export const SHOW_ZONES_STORAGE_KEY = 'gmd:zones-show-zones';

export function mapViewStorageKey(userId: string): string {
  return `gmd:zones-map-view:${userId}`;
}

export interface SavedMapView {
  lat: number;
  lon: number;
  zoom: number;
}

export function readSavedMapView(key: string | null): SavedMapView | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedMapView>;
    if (
      typeof v.lat === 'number' &&
      typeof v.lon === 'number' &&
      typeof v.zoom === 'number' &&
      Number.isFinite(v.lat) &&
      Number.isFinite(v.lon) &&
      Number.isFinite(v.zoom) &&
      Math.abs(v.lat) <= 90 &&
      Math.abs(v.lon) <= 180
    ) {
      return { lat: v.lat, lon: v.lon, zoom: v.zoom };
    }
  } catch {
    // битое значение или запрет localStorage — просто нет сохранённого вида
  }
  return null;
}

export function writeSavedMapView(key: string, v: SavedMapView): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // квота/приватный режим — не критично
  }
}

// ---------------------------------------------------------------------------
// Расписание и срок (этап 2): минуты от начала суток ↔ «HH:MM», маска дней.
// ---------------------------------------------------------------------------

/** Подписи дней недели в порядке битов маски: бит 0 — Пн … бит 6 — Вс. */
export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
export const DAYS_ALL = 0b1111111;
export const DAYS_WORKDAYS = 0b0011111;

/** 510 → «08:30». Значение приводится к суткам (0..1439). */
export function minutesToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** «08:30» → 510; «8:05» тоже принимается. Невалидное или пустое — null. */
export function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function hasDay(mask: number, day: number): boolean {
  return (mask & (1 << day)) !== 0;
}

export function toggleDay(mask: number, day: number): number {
  return (mask ^ (1 << day)) & DAYS_ALL;
}

/**
 * 31 → «Пн–Пт», 127 → «ежедневно», 96 → «Сб, Вс», 21 → «Пн, Ср, Пт»,
 * 0b1110111 → «Пн–Ср, Пт–Вс». Подряд три дня и больше — диапазоном.
 */
export function formatDaysMask(mask: number): string {
  const m = mask & DAYS_ALL;
  if (m === DAYS_ALL) return 'ежедневно';
  if (m === 0) return 'дни не выбраны';
  const parts: string[] = [];
  let d = 0;
  while (d < 7) {
    if (!hasDay(m, d)) {
      d++;
      continue;
    }
    let end = d;
    while (end + 1 < 7 && hasDay(m, end + 1)) end++;
    if (end - d >= 2) parts.push(`${WEEKDAY_SHORT[d]}–${WEEKDAY_SHORT[end]}`);
    else for (let i = d; i <= end; i++) parts.push(WEEKDAY_SHORT[i]);
    d = end + 1;
  }
  return parts.join(', ');
}

/** Окно расписания переходит через полночь (22:00–07:00). */
export function isOvernight(startMin: number, endMin: number): boolean {
  return endMin < startMin;
}

/** { daysMask: 31, startMin: 480, endMin: 900 } → «Пн–Пт 08:00–15:00». */
export function formatScheduleShort(s: {
  daysMask: number;
  startMin: number;
  endMin: number;
}): string {
  return `${formatDaysMask(s.daysMask)} ${minutesToHHMM(s.startMin)}–${minutesToHHMM(s.endMin)}`;
}

/** IANA-пояс браузера; null, если среда его не отдаёт. */
export function browserTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

/** v0.67.0: заголовок подсказки места. */
export function suggestionTitle(kind: 'home' | 'school' | 'frequent'): string {
  if (kind === 'home') return 'Дом?';
  if (kind === 'school') return 'Школа?';
  return 'Частое место';
}

/**
 * v0.67.0: чем подсказка подкреплена, по одному ребёнку:
 * «ночует здесь 7 ночей из 9», «по будням с 08:10 до 13:40 — 5 дней»,
 * «бывает здесь 4 дня, обычно 16:00–17:30».
 */
export function suggestionEvidence(
  kind: 'home' | 'school' | 'frequent',
  c: {
    days: number;
    daysWithData: number;
    typicalFromMin: number | null;
    typicalToMin: number | null;
  },
): string {
  const days = `${c.days} ${plural(c.days, 'день', 'дня', 'дней')}`;
  const from = c.typicalFromMin;
  const to = c.typicalToMin;
  if (kind === 'home') {
    return `ночует здесь ${c.days} ${plural(c.days, 'ночь', 'ночи', 'ночей')} из ${c.daysWithData}`;
  }
  if (kind === 'school') {
    return from !== null && to !== null
      ? `по будням с ${minutesToHHMM(from)} до ${minutesToHHMM(to)} — ${days}`
      : `по будням — ${days}`;
  }
  return from !== null && to !== null
    ? `бывает здесь ${days}, обычно ${minutesToHHMM(from)}–${minutesToHHMM(to)}`
    : `бывает здесь ${days}`;
}

/** v0.67.0: строки статистики визитов ребёнка в зону. */
export function zoneStatsLines(s: {
  visits: number;
  totalSec: number;
  avgSec: number;
  lastVisitFrom: string | null;
  lastVisitTo: string | null;
  ongoing: boolean;
  typicalArrivalMin: number | null;
  typicalDepartureMin: number | null;
}): string[] {
  if (s.visits === 0) return ['визитов не было'];
  const lines = [
    `${s.visits} ${plural(s.visits, 'визит', 'визита', 'визитов')} · в среднем ${formatDuration(s.avgSec)} · всего ${formatDuration(s.totalSec)}`,
  ];
  const times: string[] = [];
  if (s.typicalArrivalMin !== null) times.push(`приходит в ${minutesToHHMM(s.typicalArrivalMin)}`);
  if (s.typicalDepartureMin !== null) {
    times.push(`уходит в ${minutesToHHMM(s.typicalDepartureMin)}`);
  }
  if (times.length > 0) lines.push(`обычно ${times.join(', ')}`);
  if (s.ongoing && s.lastVisitFrom) {
    lines.push(`сейчас здесь с ${formatClock(new Date(s.lastVisitFrom))}`);
  } else if (s.lastVisitFrom && s.lastVisitTo) {
    const from = new Date(s.lastVisitFrom);
    const date = from.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    lines.push(
      `последний визит: ${date}, ${formatClock(from)}–${formatClock(new Date(s.lastVisitTo))}`,
    );
  }
  return lines;
}
