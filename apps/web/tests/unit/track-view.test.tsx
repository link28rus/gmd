/**
 * @jest-environment jsdom
 */
// v0.80.0: общий выбор вида трека (по дорогам / как записано) и переключатель на карте.
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { setTrackView, useTrackView } from '@/lib/hooks/use-track-view';
import { TrackViewToggleControl } from '@/components/locations/track-view-toggle';

const KEY = 'gmd:track-view';

function storageEvent(newValue: string | null): void {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue }));
  });
}

describe('useTrackView', () => {
  it('по умолчанию (пустой localStorage) — по дорогам', () => {
    // Первый тест файла: хранилище ещё не читало localStorage.
    localStorage.clear();
    const { result } = renderHook(() => useTrackView());
    expect(result.current[0]).toBe('road');
  });

  it('выбор общий для всех потребителей и помнится в localStorage', () => {
    const a = renderHook(() => useTrackView());
    const b = renderHook(() => useTrackView());
    act(() => a.result.current[1]('recorded'));
    expect(a.result.current[0]).toBe('recorded');
    expect(b.result.current[0]).toBe('recorded');
    expect(localStorage.getItem(KEY)).toBe('recorded');
    act(() => setTrackView('road'));
    expect(b.result.current[0]).toBe('road');
  });

  it('подхватывает выбор из соседней вкладки, мусор → по дорогам', () => {
    const { result } = renderHook(() => useTrackView());
    storageEvent('recorded');
    expect(result.current[0]).toBe('recorded');
    storageEvent('bogus');
    expect(result.current[0]).toBe('road');
  });
});

describe('TrackViewToggleControl', () => {
  beforeEach(() => act(() => setTrackView('road')));

  it('кнопка «Как записано» переключает вид', () => {
    render(<TrackViewToggleControl marginTop={80} hasTrack />);
    const btn = screen.getByRole('button', { name: /Как записано/ });
    expect(btn).toHaveAttribute('title', 'Показать трек без привязки к дорогам');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem(KEY)).toBe('recorded');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('без трека скрыта, но остаётся, если уже включено «как записано»', () => {
    render(<TrackViewToggleControl marginTop={80} hasTrack={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    act(() => setTrackView('recorded'));
    expect(screen.getByRole('button', { name: /Как записано/ })).toBeInTheDocument();
  });
});
