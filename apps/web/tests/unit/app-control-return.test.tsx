import { fireEvent, render, screen, within } from '@testing-library/react';
import ParentalControlClient from '@/app/cabinet/children/[id]/parental-control/parental-control-client';
import { BlockDialog } from '@/components/children/block-dialog';
import type { InstalledAppDto, UsageRangeDto } from '@/lib/api/app-control';
import * as hooks from '@/lib/hooks/use-app-control';

jest.mock('@/lib/hooks/use-children', () => ({ useChildren: () => ({ data: { children: [] } }) }));
jest.mock('@/lib/hooks/use-app-control', () => ({
  useAppControlStatus: jest.fn(),
  useUsage: jest.fn(),
  useInstalledApps: jest.fn(),
  useActiveBlock: jest.fn(),
  useAppRules: () => ({ data: { rules: [] } }),
  useSchedules: () => ({ data: { schedules: [] } }),
  useUpsertAppRule: () => ({}),
  useStopBlock: () => ({}),
  useCreateBlock: jest.fn(),
  useCreateSchedule: () => ({}),
  useUpdateSchedule: () => ({}),
  useDeleteSchedule: () => ({}),
}));

describe('Возвращение контроля приложений', () => {
  beforeEach(() => {
    (hooks.useCreateBlock as jest.Mock).mockReturnValue({});
    (hooks.useInstalledApps as jest.Mock).mockReturnValue({ data: { apps: [] } });
    (hooks.useUsage as jest.Mock).mockReturnValue({});
    (hooks.useActiveBlock as jest.Mock).mockReturnValue({ data: null });
    (hooks.useAppControlStatus as jest.Mock).mockReturnValue({
      data: {
        reportedAt: null,
        usageReportedAt: null,
        accessibility: null,
        usageStats: null,
        timezone: null,
        applied: false,
      },
    });
  });
  it('не предлагает блокировать телефон со старым APK и неизвестными разрешениями', () => {
    render(<ParentalControlClient childId="child" />);
    expect(screen.getByText(/Откройте обновлённый Перископ/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Заблокировать приложения/ })).toBeDisabled();
    expect(screen.queryByText('Приложения заблокированы')).not.toBeInTheDocument();
  });
  it('серверная сессия без подтверждения не выдаётся за действующую блокировку', () => {
    (hooks.useActiveBlock as jest.Mock).mockReturnValue({
      data: {
        sessionId: 'session',
        startedAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    render(<ParentalControlClient childId="child" />);
    expect(screen.getByText('Блокировка ожидает подтверждения')).toBeInTheDocument();
  });
  it('передаёт причину из диалога вместе с выбранной длительностью', () => {
    const mutate = jest.fn();
    (hooks.useCreateBlock as jest.Mock).mockReturnValue({ mutate });
    render(<BlockDialog open onOpenChange={jest.fn()} childId="child" childName="Саша" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Причина (необязательно)' }), {
      target: { value: '  Делаем уроки  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '30 мин' }));
    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать на 30 мин' }));
    expect(mutate).toHaveBeenLastCalledWith(
      { durationMin: 30, reason: 'Делаем уроки' },
      expect.any(Object),
    );
  });
  it('показывает причину на активной карточке, сохраняя статус и оставшееся время', () => {
    (hooks.useActiveBlock as jest.Mock).mockReturnValue({
      data: {
        sessionId: 'session',
        reason: 'Делаем уроки',
        startedAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    render(<ParentalControlClient childId="child" />);
    expect(screen.getByText('Делаем уроки')).toBeInTheDocument();
    expect(screen.getByText('Блокировка ожидает подтверждения')).toBeInTheDocument();
    expect(screen.getByText(/Осталось/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Снять блок' })).toBeEnabled();
  });
  it('вчера запрашивается относительно дня ребёнка на сервере', () => {
    render(<ParentalControlClient childId="child" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вчера' }));
    expect(hooks.useUsage).toHaveBeenLastCalledWith('child', 'day', 'yesterday');
  });

  const youtube: InstalledAppDto = {
    packageName: 'com.google.android.youtube',
    appLabel: 'YouTube',
    iconUrl: null,
    category: 'video',
    isSystem: true,
    firstSeenAt: '',
    lastSeenAt: '',
    todaySeconds: 720,
  };
  const browser: InstalledAppDto = {
    ...youtube,
    packageName: 'com.android.chrome',
    appLabel: 'Chrome',
    category: 'browsers',
    todaySeconds: 180,
  };

  it('ставит самые используемые приложения первыми и сравнивает полосы с лидером периода', () => {
    (hooks.useInstalledApps as jest.Mock).mockReturnValue({ data: { apps: [browser, youtube] } });
    const today: Pick<UsageRangeDto, 'byPackage'> = {
      byPackage: [
        {
          packageName: browser.packageName,
          appLabel: 'Chrome',
          category: 'browsers',
          seconds: 180,
        },
        { packageName: youtube.packageName, appLabel: 'YouTube', category: 'video', seconds: 720 },
      ],
    };
    const yesterday = { byPackage: [{ ...today.byPackage[0], seconds: 360 }] };
    (hooks.useUsage as jest.Mock).mockImplementation((_childId, _range, date) => ({
      data: { result: date === 'yesterday' ? yesterday : today },
    }));

    render(<ParentalControlClient childId="child" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('YouTube');
    expect(rows[0]).toHaveTextContent('12 мин');
    expect(rows[1]).toHaveTextContent('Chrome');
    expect(rows[1]).toHaveTextContent('3 мин');
    const chromeBar = within(rows[1]).getByRole('meter');
    expect(chromeBar).toHaveAttribute('aria-valuenow', '180');
    expect(chromeBar).toHaveAttribute('aria-valuemax', '720');
    expect(within(rows[2]).queryByRole('meter')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Chrome' } });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '720');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Вчера' }));
    const [firstRow] = screen.getAllByRole('listitem');
    expect(firstRow).toHaveTextContent('Chrome');
    expect(firstRow).toHaveTextContent('6 мин');
    expect(within(firstRow).getByRole('meter')).toHaveAttribute('aria-valuemax', '360');
    expect(screen.getAllByRole('meter')).toHaveLength(1);
  });

  it('при загрузке истории не показывает сегодняшнее время в другом периоде', () => {
    (hooks.useInstalledApps as jest.Mock).mockReturnValue({ data: { apps: [youtube] } });
    (hooks.useUsage as jest.Mock).mockReturnValue({ isPending: true });

    render(<ParentalControlClient childId="child" />);
    expect(screen.getByText(/12 мин/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Неделя' }));
    expect(screen.queryByText(/12 мин/)).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
  });
});
