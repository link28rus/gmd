// apps/web/lib/find-phone/find-phone-format.ts
// v0.73.0 «Найти телефон»: чистые хелперы страницы — подписи, статус сигнала,
// интервал опроса, границы дня. Без React/Leaflet, покрыты unit-тестами.
import type { MyPhone, PhoneSignal, PhoneTrackPoint } from '@/lib/api/find-phone';

/** Опрос списка телефонов, пока сигнал в пути или телефон звонит. */
export const FAST_POLL_MS = 5_000;
/** Обычный опрос списка телефонов. */
export const SLOW_POLL_MS = 30_000;

/**
 * Тот же порог точности, что в TrackPolyline (UI_ACCURACY_GATE_M): точки
 * грубее 50 м на карте не рисуются, поэтому и для «пустого дня»/подгонки
 * масштаба их не учитываем.
 */
export const TRACK_ACCURACY_GATE_M = 50;

/** Заданное в кабинете имя, иначе модель, иначе «Телефон». */
export function phoneLabel(phone: Pick<MyPhone, 'deviceName' | 'customName'>): string {
  const custom = phone.customName?.trim();
  if (custom) return custom;
  const name = phone.deviceName?.trim();
  return name ? name : 'Телефон';
}

/** Максимальная длина своего имени телефона (RenameDeviceSchema в backend). */
export const PHONE_NAME_MAX = 40;

export function platformLabel(platform: string | null): string | null {
  if (!platform) return null;
  const p = platform.toLowerCase();
  if (p === 'android') return 'Android';
  if (p === 'ios') return 'iOS';
  return platform;
}

/** Сигнал «живой»: ждём подтверждения или телефон звонит прямо сейчас. */
export function isSignalActive(signal: PhoneSignal | null): boolean {
  return signal?.status === 'pending' || signal?.status === 'ringing';
}

export function pollIntervalMs(items: readonly Pick<MyPhone, 'signal'>[]): number {
  return items.some((d) => isSignalActive(d.signal)) ? FAST_POLL_MS : SLOW_POLL_MS;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Строка статуса под кнопкой «Подать сигнал»; null — сигнала ещё не было. */
export function signalStatusText(signal: PhoneSignal | null): string | null {
  if (!signal) return null;
  switch (signal.status) {
    case 'pending':
      return 'Сигнал отправлен, ждём ответа телефона…';
    case 'ringing':
      return 'Телефон звонит — 60 секунд';
    case 'expired':
      return 'Телефон не ответил за 5 минут — вероятно, выключен или без интернета';
    case 'done':
      return `Телефон прозвонил в ${hhmm(signal.ackedAt ?? signal.requestedAt)}`;
    default:
      return null;
  }
}

/** «64%» / «64% · заряжается»; null — телефон заряд не сообщал. */
export function batteryText(level: number | null, charging: boolean | null): string | null {
  if (level === null) return null;
  return charging ? `${level}% · заряжается` : `${level}%`;
}

/** Секунд прошло с момента iso (не меньше 0). */
export function ageSecSince(iso: string, nowMs: number = Date.now()): number {
  return Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
}

/**
 * Границы локального дня YYYY-MM-DD: [начало дня, начало следующего дня) в
 * UTC ISO. Следующий день считаем через Date, а не +24 ч — в день перевода
 * часов сутки бывают 23/25 часов.
 */
export function dayRangeIso(ymd: string): [string, string] {
  const [y, m, d] = ymd.split('-').map(Number);
  const from = new Date(y, m - 1, d, 0, 0, 0, 0);
  const to = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return [from.toISOString(), to.toISOString()];
}

/** Точки, которые TrackPolyline реально нарисует (точность ≤ 50 м или неизвестна). */
export function drawableTrack(items: readonly PhoneTrackPoint[]): PhoneTrackPoint[] {
  return items.filter((p) => p.accuracy == null || p.accuracy <= TRACK_ACCURACY_GATE_M);
}
