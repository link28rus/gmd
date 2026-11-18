import { fireEvent, render, screen } from '@testing-library/react';
import ParentalControlClient from '@/app/cabinet/children/[id]/parental-control/parental-control-client';
import * as hooks from '@/lib/hooks/use-app-control';

jest.mock('@/lib/hooks/use-children', () => ({ useChildren: () => ({ data: { children: [] } }) }));
jest.mock('@/lib/hooks/use-app-control', () => ({
  useAppControlStatus: jest.fn(),
  useUsage: jest.fn(),
  useInstalledApps: () => ({ data: { apps: [] } }),
  useActiveBlock: jest.fn(),
  useAppRules: () => ({ data: { rules: [] } }),
  useSchedules: () => ({ data: { schedules: [] } }),
  useUpsertAppRule: () => ({}),
  useStopBlock: () => ({}),
  useCreateBlock: () => ({}),
  useCreateSchedule: () => ({}),
  useUpdateSchedule: () => ({}),
  useDeleteSchedule: () => ({}),
}));

describe('Возвращение контроля приложений', () => {
  beforeEach(() => {
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
  it('вчера запрашивается относительно дня ребёнка на сервере', () => {
    render(<ParentalControlClient childId="child" />);
    fireEvent.click(screen.getByRole('button', { name: 'Вчера' }));
    expect(hooks.useUsage).toHaveBeenLastCalledWith('child', 'day', 'yesterday');
  });
});
