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

  it('рендерит чекбоксы для каждого ребёнка', () => {
    const kids = [
      { id: 'c1', name: 'Аня' },
      { id: 'c2', name: 'Вася' },
    ];
    render(<ZoneEditorDialog open onOpenChange={() => {}} kids={kids} onSaved={() => {}} />, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText('Аня')).toBeInTheDocument();
    expect(screen.getByText('Вася')).toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
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
