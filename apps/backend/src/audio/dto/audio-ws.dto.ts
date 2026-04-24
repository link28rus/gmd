/**
 * Контракт WebSocket relay для «Звук вокруг ребёнка» (v0.35).
 *
 * Все binary-фреймы — Opus 16 kHz mono, 20 ms на фрейм. Без TLV-обёртки на MVP:
 * raw Opus bytes отдаются как-есть, gateway работает как прозрачный relay.
 * При необходимости (jitter buffer, FEC) обёртку добавим post-MVP.
 *
 * Control-сообщения — text frames (UTF-8 JSON), типы перечислены ниже.
 *
 * URL-схема: wss://<host>/audio/ws?role={child|parent}&sessionId={cuid}&token={JWT}
 *
 * Close-codes (RFC 6455 диапазон 4000-4999 — приватные):
 *   4400 — bad query (нет role/sessionId/token, неверный role)
 *   4401 — auth_failed / token_session_mismatch
 *   4404 — session_not_active (нет в БД, не PENDING/ACTIVE, чужой sub)
 *   4002 — replaced_by_new_producer (пришёл новый child WS на ту же сессию)
 *   4003 — producer_gone (parent уведомлён о уходе child'а)
 *   4004 — backpressure_overflow (consumer не успевает читать)
 *   4006 — idle_timeout (watchdog: producer не шлёт > 90с)
 *   4008 — session_terminated (parent stop / admin stop / FAILED)
 */

export type AudioWsControlOp = 'hello' | 'state' | 'error' | 'bye';

export interface AudioWsHello {
  op: 'hello';
  sessionId: string;
  role: 'child' | 'parent';
  /** Сколько секунд жить сессии с момента ACTIVE. Информационно, server всё равно завершит. */
  durationSec: number;
}

export interface AudioWsState {
  op: 'state';
  state: 'PENDING' | 'ACTIVE' | 'ENDED' | 'FAILED' | 'EXPIRED';
}

export interface AudioWsError {
  op: 'error';
  code: 'PERMISSION_DENIED' | 'MIC_BUSY' | 'OEM_BLOCKED' | 'NETWORK_ERROR' | 'UNKNOWN';
  message?: string;
}

export interface AudioWsBye {
  op: 'bye';
  reason: string;
}

export type AudioWsControlMessage = AudioWsHello | AudioWsState | AudioWsError | AudioWsBye;
