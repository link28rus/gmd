'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Ear, Mic, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Child } from '@/lib/api/children';
import { useAudioSession, type AudioUiState } from '@/lib/hooks/use-audio-session';
import { createVuMeter } from '@/lib/audio/vu-meter';
import { failReasonLabel, shouldShowMicBlockedWarning } from '@/lib/audio/fail-reason';
import { MicBlockedWarning } from './mic-blocked-warning';

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

/**
 * Пока ждём подключения телефона ребёнка (`waiting`/`negotiating`), делаем
 * подпись честной. START_AUDIO будит устройство через push; на холодную (когда
 * OEM усыпил приложение в энергосбережении) пробуждение занимает до минуты. Без
 * этого родитель видит статичное «Устанавливаем соединение», думает что зависло,
 * и жмёт «Остановить» за секунды до того, как ребёнок подключился бы.
 */
function connectingLabel(s: AudioUiState, waitSec: number): string {
  if (s === 'waiting' || s === 'negotiating') {
    return waitSec >= 5 ? 'Будим телефон ребёнка…' : 'Устанавливаем соединение…';
  }
  return stateLabel(s);
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

/**
 * Содержимое audio-сессии без Dialog-обёртки. Экспортируется чтобы
 * embed-страница `/embed/audio/[childId]` могла переиспользовать UI
 * без модального диалога — там это fullscreen-экран в WebView mobile-parent.
 *
 * `onOpenChange(false)` вызывается при остановке/закрытии, embed-страница
 * может проигнорировать (закрытия страницы внутри WebView нет — родитель
 * жмёт system back).
 */
export function AudioSessionPane({
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
  const [waitSec, setWaitSec] = useState(0);

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

  // Счётчик ожидания пробуждения устройства ребёнка. Пока идёт waiting/negotiating
  // и звук ещё не пошёл — тикаем, чтобы показать честный прогресс вместо статичной
  // надписи. Сбрасываем при любом другом состоянии.
  useEffect(() => {
    if (sessionState === 'waiting' || sessionState === 'negotiating') {
      setWaitSec(0);
      const t = setInterval(() => setWaitSec((x) => x + 1), 1000);
      return () => clearInterval(t);
    }
    setWaitSec(0);
    return undefined;
  }, [sessionState]);

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
      <header className="flex flex-col gap-1.5">
        {/* Plain HTML вместо Radix DialogTitle/Description — этот компонент
            используется и в модальном Dialog, и в /embed/audio (WebView), где
            Radix Dialog primitives без Dialog.Root кидают runtime error. */}
        <h2 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
          <Ear className="h-5 w-5 text-emerald-600" />
          Звук вокруг — {child.name}
        </h2>
        <p className="text-sm text-muted-foreground">
          Слушаем микрофон устройства ребёнка. На устройстве появится системный индикатор
          использования микрофона.
        </p>
      </header>

      <div className="space-y-4 py-2">
        {shouldShowMicBlockedWarning(child.device?.micReady, session.state) && (
          <MicBlockedWarning />
        )}

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            {session.state === 'active' ? (
              <Mic className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <MicOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
            <span aria-live="polite">{connectingLabel(session.state, waitSec)}</span>
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

        {(session.state === 'waiting' || session.state === 'negotiating') && waitSec >= 5 && (
          <p className="text-sm text-muted-foreground">
            Телефон ребёнка выходит из энергосбережения — это может занять до минуты. Не закрывайте
            окно, звук начнётся автоматически. Ждём {waitSec}&nbsp;с…
          </p>
        )}

        {(session.state === 'failed' || session.state === 'expired') && (
          <p className="text-sm text-red-600">
            {session.state === 'expired'
              ? 'Устройство ребёнка не ответило. Проверьте интернет на телефоне ребёнка.'
              : failReasonLabel(session.errorReason)}
          </p>
        )}
      </div>

      <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={() => void handleClose(false)}>
          {session.state === 'active' || session.state === 'negotiating' ? 'Остановить' : 'Закрыть'}
        </Button>
      </footer>
    </>
  );
}
