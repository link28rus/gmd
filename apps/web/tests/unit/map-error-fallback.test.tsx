/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { MapErrorFallback } from '@/components/locations/map-error-fallback';

describe('MapErrorFallback', () => {
  it('без latest — только сообщение', () => {
    render(<MapErrorFallback latest={null} />);
    expect(screen.getByText(/Не удалось загрузить карту/)).toBeInTheDocument();
  });

  it('с latest — координаты + ссылка на Яндекс.Карты', () => {
    render(
      <MapErrorFallback
        latest={{
          lat: 55.75,
          lon: 37.61,
          accuracy: 8,
          recordedAt: '2026-04-19T10:00:00.000Z',
        }}
      />,
    );
    const link = screen.getByRole('link', { name: /Открыть в Яндекс.Картах/ });
    expect(link).toHaveAttribute('href', expect.stringContaining('yandex.ru/maps'));
    expect(link.getAttribute('href')).toContain('pt=37.61%2C55.75');
  });
});
