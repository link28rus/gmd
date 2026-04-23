'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { audioApi, type AudioSseEvent, type TurnCreds } from '@/lib/api/audio';
import { AudioSessionController } from '@/lib/webrtc/audio-session-controller';
import { useAudioSse } from './use-audio-sse';

export type AudioUiState =
  | 'idle'
  | 'starting'
  | 'waiting'
  | 'negotiating'
  | 'active'
  | 'ended'
  | 'failed'
  | 'expired';

export interface UseAudioSessionResult {
  state: AudioUiState;
  sessionId: string | null;
  error: string | null;
  errorReason: string | null;
  mediaStream: MediaStream | null;
  elapsedSec: number;
  durationSec: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

interface Params {
  childId: string;
  durationSec: number;
}

/**
 * Оркестратор «Звук вокруг» для web-родителя.
 *
 * Склеивает audioApi + useAudioSse + AudioSessionController в один API для UI:
 *  - start()  → создаёт сессию, получает TURN creds, подписывается на SSE.
 *  - READY    → инициализирует WebRTC, отправляет answer.
 *  - ICE_FROM_CHILD → передаёт кандидата в PeerConnection.
 *  - ACTIVE   → запускает таймер elapsed, авто-stop при durationSec.
 *  - ENDED/FAILED/EXPIRED → чистка ресурсов + state.
 *  - stop()   → cleanup + POST /stop (best-effort).
 *
 * Интеграционно тестируется через AudioListenDialog (Task 11).
 */
export function useAudioSession({ childId, durationSec }: Params): UseAudioSessionResult {
  const [state, setState] = useState<AudioUiState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const controllerRef = useRef<AudioSessionController | null>(null);
  const turnCredsRef = useRef<TurnCreds | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStartRef = useRef<number | null>(null);
  // stop() через ref, чтобы колбэк useAudioSse не перезапускал SSE-соединение
  // при каждом изменении sessionId/state (deps у useAudioSse — только sessionId+enabled).
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const cleanup = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    activeStartRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    const id = sessionId;
    cleanup();
    setState((prev) => (prev === 'active' || prev === 'negotiating' ? 'ended' : prev));
    if (id) {
      try {
        await audioApi.stopSession(id);
      } catch {
        /* best-effort — backend может сам перевести в ENDED */
      }
    }
  }, [sessionId, cleanup]);

  stopRef.current = stop;

  const start = useCallback(async () => {
    setState('starting');
    setError(null);
    setErrorReason(null);
    setMediaStream(null);
    setElapsedSec(0);

    try {
      const res = await audioApi.createSession({ childId, durationSec, hiddenMode: true });
      setSessionId(res.id);
      turnCredsRef.current = res.turnCreds;
      setState('waiting');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать сессию');
      setState('failed');
    }
  }, [childId, durationSec]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  useAudioSse({
    sessionId,
    enabled: sessionId !== null && state !== 'ended' && state !== 'failed' && state !== 'expired',
    onError: (err) => {
      setError(err.message);
      setState('failed');
      cleanup();
    },
    onEvent: (event: AudioSseEvent) => {
      if (event.state === 'PENDING') {
        setState((prev) => (prev === 'starting' ? 'waiting' : prev));
      } else if (event.state === 'READY') {
        const payload = event.payload as { sdp: string };
        if (!turnCredsRef.current || !sessionId) return;
        if (!controllerRef.current) {
          controllerRef.current = new AudioSessionController({
            sessionId,
            turnCreds: turnCredsRef.current,
            sendAnswer: audioApi.sendAnswer,
            sendIce: audioApi.sendIce,
            onStateChange: () => {
              /* UI-статус ведётся через backend-side события (ACTIVE/ENDED/FAILED) */
            },
            onRemoteStream: (stream) => setMediaStream(stream),
          });
          controllerRef.current.init();
        }
        setState('negotiating');
        void controllerRef.current.handleReadyOffer(payload.sdp).catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'Ошибка WebRTC');
          setState('failed');
          cleanup();
        });
      } else if (event.state === 'ICE_FROM_CHILD') {
        const payload = event.payload as { candidate: string };
        void controllerRef.current?.handleIceFromChild(payload.candidate);
      } else if (event.state === 'ACTIVE') {
        activeStartRef.current = Date.now();
        setState('active');
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          if (activeStartRef.current) {
            const sec = Math.floor((Date.now() - activeStartRef.current) / 1000);
            setElapsedSec(sec);
            if (sec >= durationSec) {
              void stopRef.current();
            }
          }
        }, 250);
      } else if (event.state === 'ENDED') {
        setState('ended');
        cleanup();
      } else if (event.state === 'FAILED') {
        const reason = (event.payload as { reason?: string } | null)?.reason ?? 'UNKNOWN';
        setErrorReason(reason);
        setState('failed');
        cleanup();
      } else if (event.state === 'EXPIRED') {
        setState('expired');
        cleanup();
      }
    },
  });

  return {
    state,
    sessionId,
    error,
    errorReason,
    mediaStream,
    elapsedSec,
    durationSec,
    start,
    stop,
  };
}
