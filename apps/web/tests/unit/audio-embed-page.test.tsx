/**
 * @jest-environment jsdom
 */
import { Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

const listMock = jest.fn();

jest.mock('@/lib/api/children', () => ({
  childrenApi: { list: () => listMock() },
}));
jest.mock('@/lib/hooks/use-audio-session', () => ({
  useAudioSession: () => ({
    state: 'waiting',
    errorReason: null,
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

// eslint-disable-next-line import/first
import AudioEmbedPage from '@/app/embed/audio/[childId]/page';

const WARNING = /Микрофон на телефоне ребёнка выключен/;

function device(micReady: boolean | null) {
  return {
    id: 'd1',
    deviceName: null,
    osVersion: null,
    appVersion: null,
    lastSeenAt: null,
    revokedAt: null,
    micReady,
  };
}

async function renderPage(hash: string) {
  window.location.hash = hash;
  const params = Promise.resolve({ childId: 'c1' });
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <AudioEmbedPage params={params} />
      </Suspense>,
    );
  });
}

describe('/embed/audio — micReady', () => {
  beforeEach(() => listMock.mockReset());

  it('hash без m, свежий список micReady=false → предупреждение', async () => {
    listMock.mockResolvedValue({ children: [{ id: 'c1', name: 'Тимоха', device: device(false) }] });
    await renderPage('#t=tok&n=%D0%A2');
    await waitFor(() => expect(screen.getByText(WARNING)).toBeInTheDocument());
  });

  it('m=0 в hash → предупреждение сразу, даже если список не загрузился', async () => {
    listMock.mockRejectedValue(new Error('offline'));
    await renderPage('#t=tok&n=%D0%A2&m=0');
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
  });

  it('m=0, но свежий статус micReady=true → предупреждение снимается', async () => {
    listMock.mockResolvedValue({ children: [{ id: 'c1', name: 'Тимоха', device: device(true) }] });
    await renderPage('#t=tok&n=%D0%A2&m=0');
    expect(await screen.findByRole('heading', { name: /Звук вокруг/ })).toBeInTheDocument();
    expect(listMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(WARNING)).not.toBeInTheDocument());
  });
});
