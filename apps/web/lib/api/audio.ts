// apps/web/lib/api/audio.ts
import { apiFetch } from './client';

/**
 * Координаты для подключения к WebSocket-relay аудио-сессии (v0.35).
 * Backend кладёт сюда parent'ский URL+JWT; URL уже содержит query (role, sessionId, token),
 * клиент подключается напрямую через `new WebSocket(ws.url)`.
 */
export interface AudioWsConnInfo {
  url: string;
  token: string;
  ttlSec: number;
}

export interface CreateAudioSessionInput {
  childId: string;
  durationSec?: number;
  hiddenMode?: boolean;
}

export interface CreateAudioSessionResponse {
  id: string;
  state: 'PENDING';
  expiresAt: string;
  ws: AudioWsConnInfo;
}

export const audioApi = {
  createSession: (input: CreateAudioSessionInput) =>
    apiFetch<CreateAudioSessionResponse>('/api/audio/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  stopSession: (sessionId: string) =>
    apiFetch<void>(`/api/audio/sessions/${sessionId}/stop`, {
      method: 'POST',
    }),
};
