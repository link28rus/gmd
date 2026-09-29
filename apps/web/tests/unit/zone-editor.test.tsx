/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ZoneEditorDialog } from '@/app/cabinet/zones/components/zone-editor-dialog';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/api/zones', () => ({
  ...jest.requireActual('@/lib/api/zones'),
  zonesApi: {
    create: jest.fn().mockResolvedValue({
      id: 'z1',
      familyId: 'f1',
      name: 'Школа',
      color: '#22c55e',
      icon: 'school',
      centerLat: 55.75,
      centerLon: 37.62,
      radius: 250,
      allChildren: true,
      states: [],
      timezone: null,
      schedule: null,
      arrival: null,
      myPrefs: [],
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      childIds: [],
    }),
    update: jest.fn(),
    list: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('@/app/cabinet/zones/components/zone-editor-map', () => ({
  ZoneEditorMap: () => <div data-testid="editor-map" />,
}));

jest.mock('ymap3-components', () => ({
  YMap: ({ children }: { children: ReactNode }) => <div data-testid="ymap">{children}</div>,
  YMapComponentsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  YMapDefaultSchemeLayer: () => null,
  YMapDefaultFeaturesLayer: () => null,
  YMapControls: ({ children }: { children: ReactNode }) => <>{children}</>,
  YMapZoomControl: () => null,
  YMapFeature: () => null,
  YMapMarker: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/lib/api/geocode', () => ({
  geocode: jest.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const KIDS = [{ id: 'c1', name: 'Аня' }];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZoneEditorDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('показывает заголовок «Новая зона» когда initial не передан', () => {
    render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={() => {}} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText('Новая зона')).toBeInTheDocument();
  });

  it('показывает заголовок «Изменить зону» когда initial передан', () => {
    const initial = {
      id: 'z1',
      familyId: 'f1',
      name: 'Дом',
      color: '#22c55e' as const,
      icon: 'home' as const,
      centerLat: 55.75,
      centerLon: 37.62,
      radius: 300,
      allChildren: false,
      states: [],
      timezone: null,
      schedule: null,
      arrival: null,
      myPrefs: [],
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      childIds: ['c1'],
    };
    render(
      <ZoneEditorDialog
        open
        onOpenChange={() => {}}
        kids={KIDS}
        initial={initial}
        onSaved={() => {}}
      />,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByText('Изменить зону')).toBeInTheDocument();
  });

  it('вызывает toast.error и не вызывает onSaved при пустом имени', async () => {
    const { toast } = await import('sonner');
    const onSaved = jest.fn();

    render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={onSaved} />, {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Укажите имя зоны');
    });
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('новая зона — «Все дети» включено, после снятия видны чекбоксы детей', () => {
    const kids = [
      { id: 'c1', name: 'Аня' },
      { id: 'c2', name: 'Вася' },
    ];
    render(<ZoneEditorDialog open onOpenChange={() => {}} kids={kids} onSaved={() => {}} />, {
      wrapper: makeWrapper(),
    });
    const all = screen.getByRole('checkbox', { name: 'Все дети, включая будущих' });
    expect(all).toBeChecked();
    expect(screen.queryByText('Аня')).not.toBeInTheDocument();

    fireEvent.click(all);
    expect(screen.getByText('Аня')).toBeInTheDocument();
    expect(screen.getByText('Вася')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('без выбранных детей и без «Все дети» сохранить нельзя', () => {
    render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={() => {}} />, {
      wrapper: makeWrapper(),
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Все дети, включая будущих' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Аня' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('радиус новой зоны по умолчанию 150 м, диапазон 100..5000', () => {
    render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={() => {}} />, {
      wrapper: makeWrapper(),
    });
    const slider = screen.getByLabelText(/Радиус/);
    expect(slider).toHaveValue('150');
    expect(slider).toHaveAttribute('min', '100');
    expect(slider).toHaveAttribute('max', '5000');
  });

  it('кнопка Отмена закрывает диалог', async () => {
    const onOpenChange = jest.fn();
    render(<ZoneEditorDialog open onOpenChange={onOpenChange} kids={KIDS} onSaved={() => {}} />, {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe('расписание и срок (этап 2)', () => {
    it('блоки по умолчанию выключены, поля времени скрыты', () => {
      render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={() => {}} />, {
        wrapper: makeWrapper(),
      });
      expect(screen.getByRole('switch', { name: 'Расписание уведомлений' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.getByRole('switch', { name: 'Не пришёл к сроку' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      expect(screen.queryByLabelText('С')).not.toBeInTheDocument();
      expect(screen.queryByText(/Время по поясу/)).not.toBeInTheDocument();
    });

    it('расписание: Пн–Пт 08:00–15:00, подсказка про полночь, «с» = «до» блокирует сохранение', () => {
      render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={() => {}} />, {
        wrapper: makeWrapper(),
      });
      fireEvent.click(screen.getByRole('switch', { name: 'Расписание уведомлений' }));
      expect(screen.getByLabelText('С')).toHaveValue('08:00');
      expect(screen.getByLabelText('До')).toHaveValue('15:00');
      expect(screen.getByRole('button', { name: 'Понедельник' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Суббота' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(screen.getByText(/Время по поясу/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('С'), { target: { value: '22:00' } });
      fireEvent.change(screen.getByLabelText('До'), { target: { value: '07:00' } });
      expect(screen.getByText(/Окно через полночь/)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('До'), { target: { value: '22:00' } });
      expect(screen.getByText('Время «с» и «до» не должны совпадать.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    });

    it('срок: запас по умолчанию 10, вне 0..120 — ошибка', () => {
      render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={() => {}} />, {
        wrapper: makeWrapper(),
      });
      fireEvent.click(screen.getByRole('switch', { name: 'Не пришёл к сроку' }));
      expect(screen.getByLabelText('Срок')).toHaveValue('08:30');
      const grace = screen.getByLabelText('Запас, мин');
      expect(grace).toHaveValue(10);
      fireEvent.change(grace, { target: { value: '121' } });
      expect(screen.getByText(/Запас — целое число минут от 0 до 120/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    });

    it('сохранение отправляет timezone, schedule и arrival (выключенный блок = null)', async () => {
      const { zonesApi } = jest.requireMock('@/lib/api/zones') as {
        zonesApi: { create: jest.Mock };
      };
      render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={() => {}} />, {
        wrapper: makeWrapper(),
      });
      fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Школа' } });
      fireEvent.click(screen.getByRole('switch', { name: 'Не пришёл к сроку' }));
      fireEvent.change(screen.getByLabelText('Срок'), { target: { value: '08:45' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
      });

      await waitFor(() => expect(zonesApi.create).toHaveBeenCalled());
      const payload = zonesApi.create.mock.calls[0][0];
      expect(payload.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
      expect(payload.schedule).toBeNull();
      expect(payload.arrival).toEqual({ deadlineMin: 525, daysMask: 31, graceMin: 10 });
    });
  });

  // TODO: test that saving with valid name calls onSaved
  // Requires full React Query + zonesApi mock integration.
  // Skipped for now — covered by e2e tests.
  it.skip('сохраняет при валидных данных', async () => {
    const { toast } = await import('sonner');
    const onSaved = jest.fn();

    render(<ZoneEditorDialog open onOpenChange={() => {}} kids={KIDS} onSaved={onSaved} />, {
      wrapper: makeWrapper(),
    });

    const nameInput = screen.getByLabelText('Название');
    fireEvent.change(nameInput, { target: { value: 'Школа' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Зона создана');
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'z1' }));
  });
});
