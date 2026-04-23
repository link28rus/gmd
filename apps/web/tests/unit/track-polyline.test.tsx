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
  it('LineString + start/middle/end markers', () => {
    render(<TrackPolyline items={items} />);
    expect(screen.getByTestId('feature').getAttribute('data-type')).toBe('LineString');
    // 3 маркера: start (первый), middle-dot (промежуточная точка), end (последний).
    // Для коротких треков (<=MAX_DOTS) все промежуточные точки рендерятся
    // как точки-кружочки вдоль линии.
    expect(screen.getAllByTestId('marker')).toHaveLength(3);
  });

  it('< 2 точек → ничего не рендерит', () => {
    const { container } = render(<TrackPolyline items={items.slice(0, 1)} />);
    expect(container.firstChild).toBeNull();
  });

  // v0.31.0 — клиентский accuracy-фильтр (50м).
  it('фильтрует точки с accuracy > 50м', () => {
    const withBadPoints = [
      { ...items[0], accuracy: 10 },
      { ...items[1], accuracy: 150 }, // fuzzy indoor — должен быть выкинут
      { ...items[2], accuracy: 20 },
    ];
    render(<TrackPolyline items={withBadPoints} />);
    // После фильтрации остаётся 2 точки → только start + end, middle-dot нет.
    expect(screen.getAllByTestId('marker')).toHaveLength(2);
  });

  it('рисует stop-маркеры из trips', () => {
    const trips = [
      {
        id: 't1',
        startedAt: '2026-04-19T08:00:00.000Z',
        endedAt: '2026-04-19T09:00:00.000Z',
        isActive: false,
        pointsCount: 10,
        distanceM: 1500,
        startLat: 55.75,
        startLon: 37.61,
        endLat: 55.76,
        endLon: 37.62,
      },
    ];
    render(<TrackPolyline items={items} stops={trips} />);
    // start + end + stop(конец поездки) = 3 маркера.
    // Middle-dot'ы в режиме stops не показываются.
    expect(screen.getAllByTestId('marker')).toHaveLength(3);
  });
});
