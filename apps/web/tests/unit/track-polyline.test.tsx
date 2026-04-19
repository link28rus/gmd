/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { TrackPolyline } from '@/components/locations/track-polyline';

const items = [
  { lat: 55.75, lon: 37.61, recordedAt: '2026-04-19T08:00:00.000Z', accuracy: null, speed: null },
  { lat: 55.76, lon: 37.62, recordedAt: '2026-04-19T09:00:00.000Z', accuracy: null, speed: null },
  { lat: 55.77, lon: 37.63, recordedAt: '2026-04-19T10:00:00.000Z', accuracy: null, speed: null },
];

describe('TrackPolyline', () => {
  it('LineString + start/end markers', () => {
    render(<TrackPolyline items={items} />);
    expect(screen.getByTestId('feature').getAttribute('data-type')).toBe('LineString');
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
  });

  it('< 2 точек → ничего не рендерит', () => {
    const { container } = render(<TrackPolyline items={items.slice(0, 1)} />);
    expect(container.firstChild).toBeNull();
  });
});
