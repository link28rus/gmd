// apps/web/lib/api/geocode.ts
import { apiFetch } from './client';

export interface GeocodeHit {
  name: string;
  description: string;
  lat: number;
  lon: number;
}

/** Точка, к которой смещать поиск адреса (обычно центр карты редактора). */
export interface GeocodeNear {
  lat: number;
  lon: number;
}

/** Размер области смещения поиска в градусах (Yandex `spn`). */
const BIAS_SPAN = '0.5,0.5';

const cache = new Map<string, GeocodeHit[]>();

/**
 * Поиск адреса через серверный прокси Yandex Геокодера. Ошибки НЕ глотаются —
 * вызывающий показывает «Поиск адреса временно недоступен». В кэш кладём
 * только успешные ответы.
 */
export async function geocode(q: string, near?: GeocodeNear | null): Promise<GeocodeHit[]> {
  const text = q.trim();
  if (text.length < 2) return [];

  const params = new URLSearchParams({ q: text });
  if (near && Number.isFinite(near.lat) && Number.isFinite(near.lon)) {
    // ll = долгота,широта (порядок Yandex). Округляем — кэш не дробится на метры.
    params.set('ll', `${near.lon.toFixed(3)},${near.lat.toFixed(3)}`);
    params.set('spn', BIAS_SPAN);
  }
  const key = `${text.toLowerCase()}|${params.get('ll') ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const data = await apiFetch<{ items?: GeocodeHit[] }>(`/api/geocode?${params.toString()}`);
  const items = data?.items ?? [];
  cache.set(key, items);
  return items;
}

/** Ключ точки для обратного геокодинга: «lon,lat» с точностью ~10 м. */
export function reverseKey(lat: number, lon: number): string {
  return `${lon.toFixed(4)},${lat.toFixed(4)}`;
}

/**
 * Адрес ближайшего дома к точке («Игнатьевское шоссе, 1») или null, если
 * рядом адресов нет. Кэш — у вызывающего (react-query по reverseKey) и на
 * сервере.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeHit | null> {
  const params = new URLSearchParams({ reverse: reverseKey(lat, lon) });
  const data = await apiFetch<{ items?: GeocodeHit[] }>(`/api/geocode?${params.toString()}`);
  return data?.items?.[0] ?? null;
}

export function clearGeocodeCache(): void {
  cache.clear();
}

/** Ответ `GET /geo/ip-center` — город по IP клиента (локальная база DB-IP). */
export interface IpCenter {
  lat: number;
  lon: number;
  city: string | null;
  countryCode: string | null;
  attribution: string;
}

export const geoApi = {
  /** `null` — backend ответил 204 (приватный IP, нет в базе, база не загружена). */
  ipCenter: () => apiFetch<IpCenter | null>('/api/geo/ip-center'),
};
