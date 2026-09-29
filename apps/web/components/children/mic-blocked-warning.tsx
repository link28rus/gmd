import type { ReactElement } from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * Предупреждение в «Звук вокруг», когда телефон ребёнка сообщил `micReady=false`
 * (Android 14+ не даёт включить микрофон из фона после перезагрузки/обновления).
 * Информационное: запуск сессии не блокирует — статус мог устареть.
 */
export function MicBlockedWarning(): ReactElement {
  return (
    <div
      role="status"
      className="flex gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Микрофон на телефоне ребёнка выключен (после перезагрузки или обновления). Попросите ребёнка
        нажать на уведомление «Перископ» или открыть приложение.
      </span>
    </div>
  );
}
