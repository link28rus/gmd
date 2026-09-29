/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Zone } from '@/lib/api/zones';
import { MyNotifications } from '@/app/cabinet/zones/components/my-notifications';

const mockSet = jest.fn();
jest.mock('@/lib/api/zones', () => ({
  ...jest.requireActual('@/lib/api/zones'),
  zonesApi: {
    list: jest.fn(),
    setMyNotifications: (...args: unknown[]) => mockSet(...args),
  },
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

function makeZone(arrival: Zone['arrival']): Zone {
  return {
    id: 'z1',
    familyId: 'f1',
    name: 'Школа',
    color: '#22c55e',
    icon: 'school',
    centerLat: 0,
    centerLon: 0,
    radius: 150,
    allChildren: true,
    childIds: [],
    states: [],
    timezone: 'Asia/Vladivostok',
    schedule: null,
    arrival,
    myPrefs: [
      { childId: 'c1', onEntry: true, onExit: true, onMissedArrival: true },
      { childId: 'c2', onEntry: true, onExit: false, onMissedArrival: true },
    ],
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const NAMES = new Map([
  ['c1', 'Аня'],
  ['c2', 'Вася'],
]);

function renderWith(zone: Zone) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['zones'], [zone]);
  return render(
    <QueryClientProvider client={qc}>
      <MyNotifications zone={zone} kidNames={NAMES} />
    </QueryClientProvider>,
  );
}

describe('MyNotifications', () => {
  beforeEach(() => mockSet.mockReset());

  it('по ребёнку три переключателя и подпись «только для вас»', () => {
    renderWith(makeZone({ deadlineMin: 510, daysMask: 31, graceMin: 10 }));
    expect(screen.getByText(/Только для вас — у другого родителя свои/)).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(6);
    expect(screen.getByRole('switch', { name: 'Вася: уход' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('без срока у зоны «Не пришёл к сроку» неактивен', () => {
    renderWith(makeZone(null));
    expect(screen.getByRole('switch', { name: 'Аня: не пришёл к сроку' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Аня: приход' })).toBeEnabled();
  });

  it('переключение отправляет полный набор по всем детям зоны', async () => {
    mockSet.mockImplementation((_id: string, items: unknown) => Promise.resolve({ items }));
    renderWith(makeZone(null));
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Аня: приход' }));
    });
    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1));
    expect(mockSet).toHaveBeenCalledWith('z1', [
      { childId: 'c1', onEntry: false, onExit: true, onMissedArrival: true },
      { childId: 'c2', onEntry: true, onExit: false, onMissedArrival: true },
    ]);
  });
});
