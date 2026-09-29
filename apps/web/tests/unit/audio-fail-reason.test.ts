import { failReasonLabel, shouldShowMicBlockedWarning } from '@/lib/audio/fail-reason';
import type { AudioUiState } from '@/lib/hooks/use-audio-session';

describe('failReasonLabel', () => {
  it('MIC_BLOCKED — просьба нажать уведомление «Перископ»', () => {
    expect(failReasonLabel('MIC_BLOCKED')).toBe(
      'Телефон ребёнка не дал включить микрофон — так бывает после перезагрузки. На телефоне ребёнка появилось уведомление «Перископ»: пусть нажмёт на него, затем попробуйте снова.',
    );
  });

  it.each([
    ['PERMISSION_DENIED', 'разрешение на микрофон'],
    ['MIC_BUSY', 'Микрофон занят'],
    ['OEM_BLOCKED', 'Оболочка устройства'],
    ['NETWORK_ERROR', 'Сетевая ошибка'],
  ])('%s → свой текст', (code, fragment) => {
    expect(failReasonLabel(code)).toContain(fragment);
  });

  it('неизвестный код и null → общий текст', () => {
    const generic = 'Не удалось установить соединение. Попробуйте снова.';
    expect(failReasonLabel('SOMETHING_NEW')).toBe(generic);
    expect(failReasonLabel(null)).toBe(generic);
  });
});

describe('shouldShowMicBlockedWarning', () => {
  const shown: AudioUiState[] = ['idle', 'starting', 'waiting', 'negotiating', 'expired'];
  const hidden: AudioUiState[] = ['active', 'ended', 'failed'];

  it.each(shown)('micReady=false, %s → показываем', (s) => {
    expect(shouldShowMicBlockedWarning(false, s)).toBe(true);
  });

  it.each(hidden)('micReady=false, %s → скрываем', (s) => {
    expect(shouldShowMicBlockedWarning(false, s)).toBe(false);
  });

  it.each([true, null, undefined])('micReady=%s → никогда', (m) => {
    for (const s of [...shown, ...hidden]) {
      expect(shouldShowMicBlockedWarning(m, s)).toBe(false);
    }
  });
});
