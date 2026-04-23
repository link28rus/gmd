'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import type { AudioSseEvent } from '@/lib/api/audio';

interface Params {
  sessionId: string | null;
  enabled: boolean;
  onEvent: (event: AudioSseEvent) => void;
  onError: (err: Error) => void;
}

/**
 * Custom SSE-хук через fetch + ReadableStream.
 * Не использует EventSource — тот не умеет слать Authorization header,
 * а JWT хранится в Zustand in-memory.
 *
 * Формат backend-событий: `data: <json>\n\n` (см. docs/audio-api.md §7).
 * Парсим построчно, буферизуем между chunk'ами.
 */
export function useAudioSse({ sessionId, enabled, onEvent, onError }: Params): void {
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const controller = new AbortController();
    const token = useAuthStore.getState().accessToken;

    (async () => {
      try {
        const res = await fetch(`/api/audio/sessions/${sessionId}/events`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!res.ok || !res.body) {
          onErrorRef.current(new Error(`SSE upstream error: HTTP ${res.status}`));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '));
            if (!dataLine) continue;
            const jsonStr = dataLine.slice('data: '.length);
            try {
              const parsed = JSON.parse(jsonStr) as AudioSseEvent;
              onEventRef.current(parsed);
            } catch (e) {
              onErrorRef.current(
                new Error(`SSE parse error: ${e instanceof Error ? e.message : String(e)}`),
              );
            }
          }
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        onErrorRef.current(e instanceof Error ? e : new Error(String(e)));
      }
    })();

    return () => controller.abort();
  }, [sessionId, enabled]);
}
