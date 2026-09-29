import type { AudioUiState } from '@/lib/hooks/use-audio-session';

/**
 * Читаемый текст причины сбоя audio-сессии. `reason` — код `AudioFailureReason`
 * с backend (из WS close 4008 `child_error:<CODE>` или из статуса сессии).
 */
export function failReasonLabel(reason: string | null): string {
  switch (reason) {
    case 'PERMISSION_DENIED':
      return 'На устройстве ребёнка отключено разрешение на микрофон.';
    case 'MIC_BUSY':
      return 'Микрофон занят другим приложением (например, звонком). Попробуйте позже.';
    case 'MIC_BLOCKED':
      return 'Телефон ребёнка не дал включить микрофон — так бывает после перезагрузки. На телефоне ребёнка появилось уведомление «Перископ»: пусть нажмёт на него, затем попробуйте снова.';
    case 'OEM_BLOCKED':
      return 'Оболочка устройства заблокировала работу в фоне. Откройте инструкции для Xiaomi/Honor.';
    case 'NETWORK_ERROR':
      return 'Сетевая ошибка на устройстве ребёнка.';
    default:
      return 'Не удалось установить соединение. Попробуйте снова.';
  }
}

/**
 * Показывать ли предупреждение «микрофон выключен» (v0.62.0). Только при явном
 * `micReady === false` (`null` — старое приложение ребёнка, статус неизвестен).
 * Видно до и во время подключения и после «не ответило»; при active/ended
 * неактуально, при failed — своя причина через `failReasonLabel`.
 */
export function shouldShowMicBlockedWarning(
  micReady: boolean | null | undefined,
  state: AudioUiState,
): boolean {
  if (micReady !== false) return false;
  return (
    state === 'idle' ||
    state === 'starting' ||
    state === 'waiting' ||
    state === 'negotiating' ||
    state === 'expired'
  );
}
