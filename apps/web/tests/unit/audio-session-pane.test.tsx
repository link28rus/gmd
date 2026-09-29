/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import type { Child } from '@/lib/api/children';
import type { AudioUiState } from '@/lib/hooks/use-audio-session';

const sessionState: { state: AudioUiState; errorReason: string | null } = {
  state: 'waiting',
  errorReason: null,
};

jest.mock('@/lib/hooks/use-audio-session', () => ({
  useAudioSession: () => ({
    state: sessionState.state,
    errorReason: sessionState.errorReason,
    error: null,
    mediaStream: null,
    elapsedSec: 0,
    durationSec: 300,
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
  }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/lib/audio/vu-meter', () => ({ createVuMeter: () => () => undefined }));

import { AudioSessionPane } from '@/components/children/audio-listen-dialog';

function makeChild(micReady: boolean | null | undefined): Child {
  return {
    id: 'c1',
    name: 'Тимоха',
    dateOfBirth: null,
    protectionEnabled: false,
    protectionEnabledAt: null,
    avatarKey: null,
    device:
      micReady === undefined
        ? null
        : {
            id: 'd1',
            deviceName: null,
            osVersion: null,
            appVersion: null,
            lastSeenAt: null,
            revokedAt: null,
            micReady,
          },
  };
}

const WARNING = /Микрофон на телефоне ребёнка выключен/;

describe('AudioSessionPane — предупреждение micReady', () => {
  beforeEach(() => {
    sessionState.state = 'waiting';
    sessionState.errorReason = null;
  });

  it('micReady=false → предупреждение, кнопка доступна', () => {
    render(<AudioSessionPane child={makeChild(false)} onOpenChange={() => undefined} />);
    expect(screen.getByRole('status')).toHaveTextContent(WARNING);
    expect(screen.getByRole('status')).toHaveTextContent('уведомление «Перископ»');
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it.each([true, null, undefined])('micReady=%s → без предупреждения', (m) => {
    render(<AudioSessionPane child={makeChild(m)} onOpenChange={() => undefined} />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it('звук пошёл (active) → предупреждение скрыто', () => {
    sessionState.state = 'active';
    render(<AudioSessionPane child={makeChild(false)} onOpenChange={() => undefined} />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it('failed MIC_BLOCKED → текст причины вместо предупреждения', () => {
    sessionState.state = 'failed';
    sessionState.errorReason = 'MIC_BLOCKED';
    render(<AudioSessionPane child={makeChild(false)} onOpenChange={() => undefined} />);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(screen.getByText(/не дал включить микрофон/)).toBeInTheDocument();
  });
});
