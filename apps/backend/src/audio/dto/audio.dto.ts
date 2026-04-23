import { z } from 'zod';

// Parent: создать сессию
export const CreateAudioSessionSchema = z.object({
  childId: z.string().min(1),
  durationSec: z.number().int().positive().optional(), // если не указано — берём из app_settings
  hiddenMode: z.boolean().optional(), // default true
});
export type CreateAudioSessionDto = z.infer<typeof CreateAudioSessionSchema>;

// Parent: ответ с offer
export const ParentAnswerSchema = z.object({
  sdp: z.string().min(1).max(10_000),
});
export type ParentAnswerDto = z.infer<typeof ParentAnswerSchema>;

// Parent / Child: ICE candidate
export const IceCandidateSchema = z.object({
  candidate: z.string().min(1).max(2000),
});
export type IceCandidateDto = z.infer<typeof IceCandidateSchema>;

// Child: prepare offer
export const ChildReadySchema = z.object({
  sdp: z.string().min(1).max(10_000),
});
export type ChildReadyDto = z.infer<typeof ChildReadySchema>;

// Child: error
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

// Response shapes (no Zod, just TS types)
export interface TurnCreds {
  url: string; // turn:turn.gmd.link28rus.ru:3478
  username: string; // <ts>:<sessionId>
  password: string; // base64(HMAC_SHA1(secret, username))
  ttl: number; // seconds
}

export interface CreateAudioSessionResponse {
  id: string;
  state: 'PENDING';
  expiresAt: string; // ISO
  turnCreds: TurnCreds;
}
