// apps/web/lib/api/zones.ts
import { ApiError, apiFetch } from './client';

export type ZoneColor = '#22c55e' | '#3b82f6' | '#f59e0b' | '#ef4444' | '#a855f7' | '#64748b';

export type ZoneIcon =
  | 'home'
  | 'school'
  | 'sport'
  | 'art'
  | 'hospital'
  | 'shop'
  | 'music'
  | 'other';

/** Лимит зон на семью — backend отвечает 409 zone_limit_reached. */
export const MAX_ZONES = 20;
/** Границы радиуса по Zod-схеме backend'а (CHECK в БД шире — 50..5000). */
export const ZONE_RADIUS_MIN = 100;
export const ZONE_RADIUS_MAX = 5000;
export const ZONE_RADIUS_DEFAULT = 150;

export interface ZoneState {
  childId: string;
  isInside: boolean;
}

/** ZoneDto — спецификация геозон v2, раздел 1.4. */
export interface Zone {
  id: string;
  familyId: string;
  name: string;
  color: ZoneColor;
  icon: ZoneIcon;
  centerLat: number;
  centerLon: number;
  radius: number;
  /** Зона для всех детей семьи, включая будущих. */
  allChildren: boolean;
  /** Явные назначения; пусто при allChildren. */
  childIds: string[];
  states: ZoneState[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  zoneIcon: string;
  childId: string;
  childName: string;
  type: 'entry' | 'exit';
  lat: number;
  lon: number;
  accuracy: number | null;
  /** Время фикса — его и показываем. */
  recordedAt: string;
  createdAt: string;
  /** Только у exit: сколько ребёнок пробыл в зоне; null — вход не наблюдался. */
  durationSec: number | null;
}

export interface CreateZoneInput {
  name: string;
  color: ZoneColor;
  icon: ZoneIcon;
  centerLat: number;
  centerLon: number;
  radius: number;
  allChildren: boolean;
  /** При allChildren=true backend их игнорирует. */
  childIds: string[];
}

export type UpdateZoneInput = Partial<CreateZoneInput>;

export interface ListEventsQuery {
  childId?: string;
  zoneId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface ZoneEventsPage {
  items: ZoneEvent[];
  nextCursor: string | null;
}

export const zonesApi = {
  list: () => apiFetch<Zone[]>('/api/zones'),

  create: (input: CreateZoneInput) =>
    apiFetch<Zone>('/api/zones', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  get: (id: string) => apiFetch<Zone>(`/api/zones/${encodeURIComponent(id)}`),

  update: (id: string, input: UpdateZoneInput) =>
    apiFetch<Zone>(`/api/zones/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  remove: (id: string) =>
    apiFetch<void>(`/api/zones/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listEvents: (q: ListEventsQuery = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    return apiFetch<ZoneEventsPage>(`/api/zones/events${qs ? `?${qs}` : ''}`);
  },
};

/**
 * Русский текст ошибки операции с зоной по `code` из ответа backend'а
 * (`{ error: { code, message } }`, см. HttpExceptionFilter).
 */
export function zoneErrorMessage(e: unknown, action: 'save' | 'delete' | 'load'): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'zone_limit_reached':
        return `Достигнут лимит: в семье может быть не больше ${MAX_ZONES} зон.`;
      case 'validation_failed':
      case 'bad_request':
        return `Проверьте поля: название от 1 до 60 символов, радиус от ${ZONE_RADIUS_MIN} до ${ZONE_RADIUS_MAX} м.`;
      case 'child_not_found':
        return 'Ребёнок не найден — возможно, его удалили. Обновите страницу.';
      case 'zone_not_found':
        return 'Зона не найдена — возможно, её уже удалили.';
      case 'unauthorized':
        return 'Сессия истекла — войдите заново.';
      case 'rate_limited':
        return 'Слишком много запросов — подождите минуту.';
      default:
        break;
    }
    if (e.status >= 500) return 'Сервер временно недоступен — попробуйте позже.';
  } else {
    // fetch() бросает TypeError без сети; SyntaxError — прокси вернул не-JSON.
    return 'Нет связи с сервером — проверьте интернет и попробуйте ещё раз.';
  }
  const status = e.status;
  if (action === 'delete') return `Не удалось удалить зону (ошибка ${status}).`;
  if (action === 'load') return `Не удалось загрузить зоны (ошибка ${status}).`;
  return `Не удалось сохранить зону (ошибка ${status}).`;
}
