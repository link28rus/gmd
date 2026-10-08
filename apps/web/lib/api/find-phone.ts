// apps/web/lib/api/find-phone.ts
// v0.73.0 «Найти телефон»: свои телефоны родителя (приложение «Перископ Родителя»),
// их маршрут и удалённый звонок. Только телефоны ТЕКУЩЕГО пользователя.
import { apiFetch } from './client';
import type { LocationDto } from './locations';

/**
 * Статус сигнала «Подать сигнал»:
 * - `pending` — отправлен, телефон ещё не подтвердил (живёт 5 минут);
 * - `ringing` — телефон подтвердил меньше 60 секунд назад, звонит;
 * - `done` — звонил раньше;
 * - `expired` — подтверждения за 5 минут не было.
 */
export type PhoneSignalStatus = 'pending' | 'ringing' | 'done' | 'expired';

export interface PhoneSignal {
  id: string;
  requestedAt: string;
  ackedAt: string | null;
  status: PhoneSignalStatus;
}

export interface PhoneLatest {
  lat: number;
  lon: number;
  accuracy: number | null;
  recordedAt: string;
  ageSec: number;
  /** Заряд в процентах 0..100. */
  batteryLevel: number | null;
  isCharging: boolean | null;
}

export interface MyPhone {
  id: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  /** false — push-токена нет, сигнал дойдёт со следующей выгрузкой координат (≤ 5 мин). */
  canPush: boolean;
  latest: PhoneLatest | null;
  signal: PhoneSignal | null;
}

export interface MyPhonesResponse {
  items: MyPhone[];
}

/** Точка маршрута — та же форма, что у трека ребёнка (рисуем тем же TrackPolyline). */
export type PhoneTrackPoint = LocationDto;

export interface PhoneSignalResult {
  signalId: string;
  requestedAt: string;
  /** false — push не ушёл, телефон заберёт сигнал при следующем выходе на связь. */
  pushed: boolean;
}

export const findPhoneApi = {
  /** Свои телефоны, свежие сверху (по lastSeenAt). */
  getMyDevices: () => apiFetch<MyPhonesResponse>('/api/parent-location/my-devices'),

  /** Маршрут за [from, to) — не больше 2 суток; точки старше ~30 дней удалены. */
  getTrack: (deviceId: string, from: string, to: string) => {
    const qs = new URLSearchParams({ from, to });
    return apiFetch<{ items: PhoneTrackPoint[] }>(
      `/api/parent-location/my-devices/${encodeURIComponent(deviceId)}/track?${qs.toString()}`,
    );
  },

  /** Заставить телефон звонить 60 секунд (лимит 6 в минуту → 429). */
  signal: (deviceId: string) =>
    apiFetch<PhoneSignalResult>(
      `/api/parent-location/my-devices/${encodeURIComponent(deviceId)}/signal`,
      { method: 'POST' },
    ),
};
