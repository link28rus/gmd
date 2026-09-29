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
