'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Ear, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Child } from '@/lib/api/children';
import { useAudioSession, type AudioUiState } from '@/lib/hooks/use-audio-session';
import { createVuMeter } from '@/lib/webrtc/vu-meter';

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const DURATION_SEC = 300; // 5 мин — совпадает с backend default

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

function stateLabel(s: AudioUiState): string {
  switch (s) {
    case 'idle':
      return 'Готово к подключению';
    case 'starting':
      return 'Создаём сессию…';
    case 'waiting':
      return 'Ожидаем ответ от устройства ребёнка…';
    case 'negotiating':
      return 'Устанавливаем соединение…';
    case 'active':
      return 'Подключено';
    case 'ended':
      return 'Сессия завершена';
    case 'failed':
      return 'Ошибка соединения';
    case 'expired':
      return 'Устройство не отвечает';
  }
}

function failReasonLabel(reason: string | null): string {
  switch (reason) {
    case 'PERMISSION_DENIED':
      return 'На устройстве ребёнка отключено разрешение на микрофон.';
    case 'MIC_BUSY':
      return 'Микрофон занят другим приложением (например, звонком). Попробуйте позже.';
    case 'OEM_BLOCKED':
      return 'Оболочка устройства заблокировала работу в фоне. Откройте инструкции для Xiaomi/Honor.';
    case 'NETWORK_ERROR':
      return 'Сетевая ошибка на устройстве ребёнка.';
    default:
      return 'Не удалось установить соединение. Попробуйте снова.';
  }
}

export function AudioListenDialog({ child, open, onOpenChange }: Props): ReactElement {
  // Внутренний компонент `AudioSessionPane` содержит `useAudioSession` и всю
  // логику. Он монтируется только когда `open=true`, поэтому при закрытии
  // диалога hook unmount'ится и state не протечёт на следующее открытие
  // (иначе повторный open показывал бы 'expired'/'ended' от прошлой сессии,
  // а useEffect автостарта проверяет state==='idle' и ничего не делал).
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? <AudioSessionPane child={child} onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AudioSessionPane({
  child,
  onOpenChange,
}: {
  child: Child;
  onOpenChange: (v: boolean) => void;
}): ReactElement {
  const session = useAudioSession({ childId: child.id, durationSec: DURATION_SEC });
  const { state: sessionState, start: sessionStart } = session;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [level, setLevel] = useState(0);

  // Привязываем MediaStream к <audio>
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (session.mediaStream) {
      el.srcObject = session.mediaStream;
      void el.play().catch(() => {
        /* autoplay может быть заблокирован; dialog открыт по клику — обычно ок */
      });
    } else {
      el.srcObject = null;
    }
  }, [session.mediaStream]);

  // VU-meter
  useEffect(() => {
    if (!session.mediaStream) {
      setLevel(0);
      return;
    }
    const stop = createVuMeter(session.mediaStream, setLevel);
    return stop;
  }, [session.mediaStream]);

  // Автостарт при mount (pane рендерится только когда open=true).
  useEffect(() => {
    if (sessionState === 'idle') {
      void sessionStart();
    }
  }, [sessionState, sessionStart]);

  // Toast на FAILED/EXPIRED
  useEffect(() => {
    if (session.state === 'failed') {
      toast.error(failReasonLabel(session.errorReason));
    } else if (session.state === 'expired') {
      toast.error('Устройство ребёнка не отвечает. Возможно, оно офлайн.');
    }
  }, [session.state, session.errorReason]);

  const handleClose = async (v: boolean) => {
    if (!v) {
      if (
        session.state === 'active' ||
        session.state === 'negotiating' ||
        session.state === 'waiting' ||
        session.state === 'starting'
      ) {
        await session.stop();
      }
    }
    onOpenChange(v);
  };

  const elapsed = formatMmSs(session.elapsedSec);
  const total = formatMmSs(session.durationSec);
  const levelPct = Math.round(level * 100);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Ear className="h-5 w-5 text-emerald-600" />
          Звук вокруг — {child.name}
        </DialogTitle>
        <DialogDescription>
          Слушаем микрофон устройства ребёнка. На устройстве появится системный индикатор
          использования микрофона.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            {session.state === 'active' ? (
              <Mic className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <MicOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
            <span aria-live="polite">{stateLabel(session.state)}</span>
          </div>
          <span className="font-mono text-sm tabular-nums">
            {elapsed} / {total}
          </span>
        </div>

        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={levelPct}
          aria-label="Уровень звука"
        >
          <div
            className="h-full bg-emerald-500 transition-[width] duration-75"
            style={{ width: `${levelPct}%` }}
          />
        </div>

        <audio ref={audioRef} autoPlay playsInline className="sr-only" />

        {(session.state === 'failed' || session.state === 'expired') && (
          <p className="text-sm text-red-600">
            {session.state === 'expired'
              ? 'Устройство ребёнка не ответило. Проверьте интернет на телефоне ребёнка.'
              : failReasonLabel(session.errorReason)}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => void handleClose(false)}>
          {session.state === 'active' || session.state === 'negotiating' ? 'Остановить' : 'Закрыть'}
        </Button>
      </DialogFooter>
    </>
  );
}
