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
/** Запас к сроку «не пришёл» (минуты) — границы Zod-схемы backend'а. */
export const ARRIVAL_GRACE_MIN = 0;
export const ARRIVAL_GRACE_MAX = 120;
export const ARRIVAL_GRACE_DEFAULT = 10;

/** Маска дней недели: бит 0 — понедельник … бит 6 — воскресенье (1..127). */
export type DaysMask = number;

/**
 * Окно уведомлений о приходе/уходе (минуты от начала суток в поясе зоны).
 * `endMin < startMin` — окно через полночь; `startMin === endMin` запрещено.
 */
export interface ZoneSchedule {
  daysMask: DaysMask;
  startMin: number;
  endMin: number;
}

/** «Не пришёл к сроку»: срок (минуты от начала суток), дни, запас 0..120 мин. */
export interface ZoneArrival {
  deadlineMin: number;
  daysMask: DaysMask;
  graceMin: number;
}

/** Личные настройки уведомлений текущего пользователя по одному ребёнку зоны. */
export interface ZoneChildPrefs {
  childId: string;
  onEntry: boolean;
  onExit: boolean;
  onMissedArrival: boolean;
}

export interface ZoneState {
  childId: string;
  isInside: boolean;
}

/** ZoneDto — спецификация геозон v2, разделы 1.4 и 2.4. */
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
  /** IANA-пояс, в котором заданы расписание и срок; null — не задавался. */
  timezone: string | null;
  /** Расписание уведомлений (общее на семью); null — круглосуточно. */
  schedule: ZoneSchedule | null;
  /** «Не пришёл к сроку» (общее на семью); null — выключено. */
  arrival: ZoneArrival | null;
  /** Личные настройки текущего пользователя по всем детям зоны (с умолчаниями). */
  myPrefs: ZoneChildPrefs[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type ZoneEventType = 'entry' | 'exit' | 'missed_arrival' | 'no_data';

export interface ZoneEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  zoneColor: string;
  zoneIcon: string;
  childId: string;
  childName: string;
  /**
   * missed_arrival / no_data — «не пришёл к сроку» (этап 2); у них координаты —
   * последняя точка ребёнка или центр зоны.
   */
  type: ZoneEventType;
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
  /** IANA-пояс браузера; обязателен, если задано расписание или срок. */
  timezone?: string;
  /** null — снять расписание. */
  schedule?: ZoneSchedule | null;
  /** null — снять «не пришёл к сроку». */
  arrival?: ZoneArrival | null;
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

  /** Личные настройки текущего пользователя; ответ — итоговые настройки. */
  setMyNotifications: (id: string, items: ZoneChildPrefs[]) =>
    apiFetch<{ items: ZoneChildPrefs[] }>(`/api/zones/${encodeURIComponent(id)}/my-notifications`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),

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
export function zoneErrorMessage(e: unknown, action: 'save' | 'delete' | 'load' | 'prefs'): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'zone_limit_reached':
        return `Достигнут лимит: в семье может быть не больше ${MAX_ZONES} зон.`;
      case 'validation_failed':
      case 'bad_request':
        return `Проверьте поля: название от 1 до 60 символов, радиус от ${ZONE_RADIUS_MIN} до ${ZONE_RADIUS_MAX} м, дни и время расписания и срока.`;
      case 'child_not_found':
        return 'Ребёнок не найден — возможно, его удалили. Обновите страницу.';
      case 'timezone_required':
        return 'Не удалось определить часовой пояс браузера — расписание и срок без него не сохранить.';
      case 'invalid_timezone':
        return 'Часовой пояс браузера не распознан сервером — проверьте настройки времени на компьютере.';
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
  if (action === 'prefs') return `Не удалось сохранить настройки уведомлений (ошибка ${status}).`;
  return `Не удалось сохранить зону (ошибка ${status}).`;
}
