// apps/web/lib/api/audio.ts
import { apiFetch } from './client';

export interface TurnCreds {
  url: string;
  username: string;
  password: string;
  ttl: number;
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
  turnCreds: TurnCreds;
}

export type AudioSseState =
  | 'PENDING'
  | 'READY'
  | 'ACTIVE'
  | 'ICE' // backend шлёт {side: 'child'|'parent', candidate}; клиент обрабатывает только side='child'
  | 'ENDED'
  | 'FAILED'
  | 'EXPIRED';

export type AudioSsePayload =
  | null
  | { sdp: string }
  | { candidate: string }
  | { actualSec: number }
  | { reason: string };

export interface AudioSseEvent {
  state: AudioSseState;
  payload: AudioSsePayload;
}

export const audioApi = {
  createSession: (input: CreateAudioSessionInput) =>
    apiFetch<CreateAudioSessionResponse>('/api/audio/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  sendAnswer: (sessionId: string, sdp: string) =>
    apiFetch<void>(`/api/audio/sessions/${sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ sdp }),
    }),
  sendIce: (sessionId: string, candidate: string) =>
    apiFetch<void>(`/api/audio/sessions/${sessionId}/ice`, {
      method: 'POST',
      body: JSON.stringify({ candidate }),
    }),
  stopSession: (sessionId: string) =>
    apiFetch<void>(`/api/audio/sessions/${sessionId}/stop`, {
      method: 'POST',
    }),
};
