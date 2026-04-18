// apps/web/tests/unit/device-status-badge.test.tsx
import { render, screen } from '@testing-library/react';
import { DeviceStatusBadge } from '@/components/children/device-status-badge';
import type { ChildDevice } from '@/lib/api/children';

const now = new Date('2026-04-19T12:00:00Z');

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(now);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('DeviceStatusBadge', () => {
  it('null device → Не привязано', () => {
    render(<DeviceStatusBadge device={null} />);
    expect(screen.getByText('Не привязано')).toBeInTheDocument();
  });

  it('revokedAt != null → Отозвано', () => {
    const d: ChildDevice = mk({ revokedAt: '2026-04-19T11:00:00Z' });
    render(<DeviceStatusBadge device={d} />);
    expect(screen.getByText('Отозвано')).toBeInTheDocument();
  });

  it('lastSeenAt null → Привязано', () => {
    const d: ChildDevice = mk({ lastSeenAt: null });
    render(<DeviceStatusBadge device={d} />);
    expect(screen.getByText('Привязано')).toBeInTheDocument();
  });

  it('lastSeenAt < 5 мин назад → Онлайн', () => {
    const d: ChildDevice = mk({ lastSeenAt: new Date(now.getTime() - 2 * 60_000).toISOString() });
    render(<DeviceStatusBadge device={d} />);
    expect(screen.getByText('Онлайн')).toBeInTheDocument();
  });

  it('10 мин назад → "10 мин назад"', () => {
    const d: ChildDevice = mk({ lastSeenAt: new Date(now.getTime() - 10 * 60_000).toISOString() });
    render(<DeviceStatusBadge device={d} />);
    expect(screen.getByText('10 мин назад')).toBeInTheDocument();
  });

  it('3 часа назад → "3 ч назад"', () => {
    const d: ChildDevice = mk({
      lastSeenAt: new Date(now.getTime() - 3 * 60 * 60_000).toISOString(),
    });
    render(<DeviceStatusBadge device={d} />);
    expect(screen.getByText('3 ч назад')).toBeInTheDocument();
  });

  it('> 24ч назад → дата DD.MM в HH:mm', () => {
    const d: ChildDevice = mk({ lastSeenAt: '2026-04-15T09:30:00Z' });
    render(<DeviceStatusBadge device={d} />);
    expect(screen.getByText(/15\.04 в/)).toBeInTheDocument();
  });
});

function mk(over: Partial<ChildDevice> = {}): ChildDevice {
  return {
    id: 'd1',
    deviceName: null,
    osVersion: null,
    appVersion: null,
    lastSeenAt: null,
    revokedAt: null,
    ...over,
  };
}
