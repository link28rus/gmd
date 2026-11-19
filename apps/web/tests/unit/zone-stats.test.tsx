/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { ZoneStats } from '@/app/cabinet/zones/components/zone-stats';

const mockUseZoneStats = jest.fn();
jest.mock('@/lib/hooks/use-zones', () => ({
  useZoneStats: (...args: unknown[]) => mockUseZoneStats(...args),
}));

const child = {
  childId: 'c1',
  visits: 2,
  totalSec: 5400,
  avgSec: 2700,
  lastVisitFrom: null,
  lastVisitTo: null,
  ongoing: false,
  typicalArrivalMin: null,
  typicalDepartureMin: null,
};

it('показывает время в зоне и приложения и меняет период по кнопке', () => {
  mockUseZoneStats.mockImplementation((_id, period) => ({
    data: {
      children: [
        {
          ...child,
          usage:
            period === 'today'
              ? { coverage: 'none', totalSec: 0, apps: [] }
              : {
                  coverage: 'partial',
                  totalSec: 600,
                  apps: [{ packageName: 'app.video', appLabel: 'Видео', seconds: 600 }],
                },
        },
      ],
    },
  }));

  render(<ZoneStats zoneId="z1" kidNames={new Map([['c1', 'Аня']])} />);
  expect(mockUseZoneStats).toHaveBeenLastCalledWith('z1', 'week');
  expect(screen.getByText('В зоне · 1 ч 30 мин')).toBeVisible();
  expect(screen.getByText('Экранное время · 10 мин')).toBeVisible();
  expect(screen.getByText('Видео')).toBeVisible();
  expect(screen.getByText('Данные об активности есть за часть времени в зоне.')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
  expect(mockUseZoneStats).toHaveBeenLastCalledWith('z1', 'today');
  expect(screen.getByText('Нет данных об использовании приложений в зоне.')).toBeVisible();
  expect(screen.queryByText('Видео')).toBeNull();
});
