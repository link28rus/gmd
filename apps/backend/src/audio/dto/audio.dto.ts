import { z } from 'zod';

// Parent: создать сессию
export const CreateAudioSessionSchema = z.object({
  childId: z.string().min(1),
  durationSec: z.number().int().positive().optional(), // если не указано — берём из app_settings
  hiddenMode: z.boolean().optional(), // default true
});
export type CreateAudioSessionDto = z.infer<typeof CreateAudioSessionSchema>;

// Child: error report (legacy HTTP — оставлен для обратной совместимости с mobile-child v0.34.x;
// в v0.35 child должен слать через WS control frame {op:'error', code, message}).
export const ChildErrorSchema = z.object({
  code: z.enum(['PERMISSION_DENIED', 'MIC_BUSY', 'OEM_BLOCKED', 'NETWORK_ERROR', 'UNKNOWN']),
  message: z.string().max(500).optional(),
});
export type ChildErrorDto = z.infer<typeof ChildErrorSchema>;

// Admin: PATCH audio settings
export const UpdateAudioSettingsSchema = z.object({
  defaultDurationSec: z.number().int().min(30).max(1800).optional(),
  maxDurationSec: z.number().int().min(60).max(3600).optional(),
  minDurationSec: z.number().int().min(10).max(600).optional(),
  hiddenModeAllowed: z.boolean().optional(),
  childReadyTimeoutSec: z.number().int().min(5).max(120).optional(),
});
export type UpdateAudioSettingsDto = z.infer<typeof UpdateAudioSettingsSchema>;

// ─── Response shapes ──────────────────────────────────────────────────────────

/**
 * Координаты для подключения клиента к WebSocket-relay.
 * Возвращаются parent'у в response startSession; для child'а — кладутся в
 * payload START_AUDIO device-команды.
 */
export interface AudioWsConnInfo {
  /** Полный URL с query-параметрами role, sessionId, token. */
  url: string;
  /** JWT (HS256, AUDIO_WS_SECRET). Дублируется в URL для удобства; используйте либо то, либо другое. */
  token: string;
  /** Сколько секунд токен валиден. */
  ttlSec: number;
}

export interface CreateAudioSessionResponse {
  id: string;
  state: 'PENDING';
  /** ISO. До этого момента child должен подключиться к WS, иначе сессия EXPIRED. */
  expiresAt: string;
  /** Координаты подключения parent'а к WS-relay. */
  ws: AudioWsConnInfo;
}
