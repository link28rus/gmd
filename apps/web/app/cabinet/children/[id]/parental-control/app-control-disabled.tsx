import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldOff } from 'lucide-react';

/**
 * Заглушка «Родительского контроля», пока функция отключена (см.
 * `lib/features.ts`). Нужна для прямых ссылок и для старых версий
 * mobile-parent, у которых пункт меню ещё открывает embed-страницу.
 */
export default function AppControlDisabled({
  onBack,
}: {
  /** Embed-режим (WebView mobile-parent): закрыть экран вместо ссылки. */
  onBack?: () => void;
}): ReactElement {
  const backClass =
    'flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted';
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className={backClass}
            title="Закрыть"
            aria-label="Закрыть"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <Link href="/cabinet" className={backClass} title="Назад" aria-label="Назад">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
        <h1 className="text-2xl font-semibold text-foreground">Родительский контроль</h1>
      </div>
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Функция временно отключена</p>
          <p className="text-sm text-muted-foreground">
            Блокировка приложений и статистика экранного времени сейчас не работают: приложение
            ребёнка больше не запрашивает для них разрешения. Геолокация, SOS, «Звук вокруг» и
            защита от удаления работают как прежде.
          </p>
        </div>
      </div>
    </div>
  );
}
