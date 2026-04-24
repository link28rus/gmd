'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { audioApi } from '@/lib/api/audio';
import { WebAudioOpusPlayer, type OpusPlayerState } from '@/lib/audio/opus-player';

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
 * Оркестратор «Звук вокруг» для web-родителя (v0.35: WebSocket-relay).
 *
 * Поток:
 *  - start() → POST /audio/sessions → получаем ws.url + token, переход 'starting' → 'waiting'.
 *  - new WebAudioOpusPlayer(ws.url).start() → WS connect → 'negotiating'.
 *  - Первый decoded Opus-фрейм → 'active', стартует elapsed timer и авто-stop при durationSec.
 *  - WS close с известным code → mapping в 'ended'/'expired'/'failed'.
 *  - Backend control 'error' (от child'а) → 'failed' с errorReason.
 *  - stop() → player.stop() + POST /stop (best-effort).
 *
 * Контракт `mediaStream: MediaStream | null` сохранён — opus-player отдаёт
 * MediaStreamAudioDestinationNode.stream, привязывается к <audio> и vu-meter без
 * изменений в UI.
 */
export function useAudioSession({ childId, durationSec }: Params): UseAudioSessionResult {
  const [state, setState] = useState<AudioUiState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const playerRef = useRef<WebAudioOpusPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStartRef = useRef<number | null>(null);
  // stop через ref, чтобы коллбеки player'а не пересоздавали player при каждом перерендере.
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const cleanup = useCallback(() => {
    playerRef.current?.stop();
    playerRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    activeStartRef.current = null;
    setMediaStream(null);
  }, []);

  const stop = useCallback(async () => {
    const id = sessionId;
    cleanup();
    setState((prev) => (prev === 'active' || prev === 'negotiating' ? 'ended' : prev));
    if (id) {
      try {
        await audioApi.stopSession(id);
      } catch {
        /* best-effort — backend сам перейдёт в ENDED по close WS */
      }
    }
  }, [sessionId, cleanup]);

  stopRef.current = stop;

  const startElapsedTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    activeStartRef.current = Date.now();
    timerRef.current = setInterval(() => {
      if (activeStartRef.current) {
        const sec = Math.floor((Date.now() - activeStartRef.current) / 1000);
        setElapsedSec(sec);
        if (sec >= durationSec) {
          void stopRef.current();
        }
      }
    }, 250);
  }, [durationSec]);

  /**
   * Map WS close-code → UI state. Источник кодов: backend audio-ws.dto.ts.
   *  4006 — idle_timeout / pending_timeout (child не подключился) → 'expired'
   *  4008 — session_terminated (parent stop / endSession) → 'ended' (если уже не failed)
   *  4404 — session_not_active → 'failed'
   *  4401 — invalid_token / token_session_mismatch → 'failed' (auth)
   *  4400 — bad query — клиентский баг, тоже 'failed'
   *  4002/4003 — replaced_by_new_producer / producer_gone → 'expired'
   *  1000 — нормальный close (parent_stop) → не меняем (stop() уже выставил 'ended')
   *  1006 — abnormal close (network) → 'failed' если активной не было, иначе 'ended'
   */
  const handleCloseCode = useCallback(
    (code: number, reason: string, currentState: AudioUiState) => {
      if (code === 1000) return; // штатный stop, состояние уже выставлено
      if (code === 4006 || code === 4002 || code === 4003) {
        setState((prev) => (prev === 'active' ? 'ended' : 'expired'));
        return;
      }
      if (code === 4008) {
        setState((prev) => (prev === 'failed' ? prev : prev === 'active' ? 'ended' : 'expired'));
        return;
      }
      if (code === 4401 || code === 4404 || code === 4400) {
        setError(`Не удалось подключиться к серверу (code ${code})`);
        setState('failed');
        return;
      }
      // 1006 + прочее
      if (currentState === 'active') {
        setState('ended');
      } else {
        setError(reason || `Соединение разорвано (code ${code})`);
        setState('failed');
      }
    },
    [],
  );

  const start = useCallback(async () => {
    cleanup();
    setState('starting');
    setError(null);
    setErrorReason(null);
    setElapsedSec(0);

    let createdSessionId: string | null = null;
    let wsUrl: string | null = null;
    try {
      const res = await audioApi.createSession({ childId, durationSec, hiddenMode: true });
      createdSessionId = res.id;
      wsUrl = res.ws.url;
      setSessionId(res.id);
      setState('waiting');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать сессию');
      setState('failed');
      return;
    }

    let stateAtClose: AudioUiState = 'waiting';
    const player = new WebAudioOpusPlayer(wsUrl, {
      onStateChange: (s: OpusPlayerState) => {
        if (s === 'connected') {
          setState((prev) => {
            stateAtClose = prev === 'waiting' ? 'negotiating' : prev;
            return prev === 'waiting' ? 'negotiating' : prev;
          });
        } else if (s === 'streaming') {
          setState('active');
          stateAtClose = 'active';
          startElapsedTimer();
        }
      },
      onCloseCode: (code, reason) => {
        handleCloseCode(code, reason, stateAtClose);
        cleanup();
      },
      onError: (err) => {
        setError(err.message);
        setState('failed');
        cleanup();
      },
      onChildError: (code) => {
        setErrorReason(code);
        setState('failed');
        cleanup();
      },
    });
    playerRef.current = player;
    try {
      const stream = await player.start();
      setMediaStream(stream);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подключить аудио');
      setState('failed');
      cleanup();
      // Best-effort stop сессии на backend, чтобы не висела в PENDING.
      if (createdSessionId) {
        audioApi.stopSession(createdSessionId).catch(() => {
          /* ignore */
        });
      }
    }
  }, [childId, durationSec, cleanup, startElapsedTimer, handleCloseCode]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

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
