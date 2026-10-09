'use client';

// v0.80.0: вид трека на картах кабинета — «по дорогам» (по умолчанию, backend
// привязывает трек к дорогам через OSRM) или «как записано» (без привязки).
// Выбор один на все карты (ребёнок, история передвижений, «Найти телефон»)
// и помнится в localStorage. Хранилище модульное: переключатель на карте и
// хук запроса трека — разные компоненты, они должны видеть одно значение.

import { useSyncExternalStore } from 'react';
import type { TrackView } from '@/lib/api/locations';

export type { TrackView };

export const DEFAULT_TRACK_VIEW: TrackView = 'road';

const STORAGE_KEY = 'gmd:track-view';

const listeners = new Set<() => void>();
/** null — ещё не читали localStorage. */
let current: TrackView | null = null;

function parse(v: string | null): TrackView {
  return v === 'recorded' ? 'recorded' : DEFAULT_TRACK_VIEW;
}

function getSnapshot(): TrackView {
  if (current === null) {
    try {
      current = parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      // localStorage недоступен — остаёмся на умолчании (выбор живёт в памяти)
      current = DEFAULT_TRACK_VIEW;
    }
  }
  return current;
}

function getServerSnapshot(): TrackView {
  return DEFAULT_TRACK_VIEW;
}

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Выбор в соседней вкладке тоже подхватываем.
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== STORAGE_KEY) return;
    current = parse(e.newValue);
    emit();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setTrackView(v: TrackView): void {
  current = v;
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // не критично — выбор действует до перезагрузки страницы
  }
  emit();
}

/** Текущий вид трека + сеттер (общий для всех карт). */
export function useTrackView(): [TrackView, (v: TrackView) => void] {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [view, setTrackView];
}
