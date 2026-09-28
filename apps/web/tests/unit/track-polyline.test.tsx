/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { TrackPolyline } from '@/components/locations/track-polyline';

// react-leaflet — ESM и без <MapContainer> не рендерится; мокаем слои
// простыми div'ами с нужными для проверки атрибутами.
jest.mock('react-leaflet', () => {
  const React = require('react');
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Polyline: ({ positions, pathOptions }: any) =>
      React.createElement('div', {
        'data-testid': 'polyline',
        'data-positions': JSON.stringify(positions),
        'data-dash': pathOptions?.dashArray ?? '',
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Marker: ({ position, icon, title }: any) =>
      React.createElement('div', {
        'data-testid': 'marker',
        'data-position': JSON.stringify(position),
        'data-icon': icon?.options?.className ?? '',
        title,
        dangerouslySetInnerHTML: { __html: icon?.options?.html ?? '' },
      }),
  };
});

type Item = {
  lat: number;
  lon: number;
  recordedAt: string;
  accuracy: number | null;
  speed: number | null;
};

const T0 = Date.parse('2026-04-19T08:00:00.000Z');
// 0.001° широты ≈ 111 м.
const at = (min: number, dLat: number, accuracy: number | null = null): Item => ({
  lat: 55.75 + dLat,
  lon: 37.61,
  recordedAt: new Date(T0 + min * 60_000).toISOString(),
  accuracy,
  speed: null,
});

// Непрерывный трек: точка раз в минуту, шаг ~111 м — разрывов нет.
const items = [at(0, 0), at(1, 0.001), at(2, 0.002)];

const polylines = (): HTMLElement[] => screen.queryAllByTestId('polyline');
const solid = (): HTMLElement[] => polylines().filter((p) => p.dataset.dash === '');
const dashed = (): HTMLElement[] => polylines().filter((p) => p.dataset.dash !== '');
const markers = (cls?: string): HTMLElement[] =>
  screen.queryAllByTestId('marker').filter((m) => !cls || m.dataset.icon === cls);

describe('TrackPolyline', () => {
  it('сплошная линия + start/middle/end markers', () => {
    render(<TrackPolyline items={items} />);
    expect(solid()).toHaveLength(1);
    expect(dashed()).toHaveLength(0);
    // start (первый) + middle-dot + end (последний).
    expect(markers()).toHaveLength(3);
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
    expect(markers()).toHaveLength(2);
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
    expect(markers()).toHaveLength(3);
  });

  it('разрыв в данных — два сплошных сегмента + серый пунктир с подписью', () => {
    const track = [at(0, 0), at(1, 0.001), at(68, 0.02), at(69, 0.021)]; // 67 мин, ~2 км
    render(<TrackPolyline items={track} />);
    expect(solid()).toHaveLength(2);
    expect(dashed()).toHaveLength(1);
    expect(dashed()[0].dataset.positions).toBe(
      JSON.stringify([
        [track[1].lat, track[1].lon],
        [track[2].lat, track[2].lon],
      ]),
    );
    expect(markers('gmd-gap-label')).toHaveLength(1);
    expect(screen.getByText('нет данных 1 ч 7 мин')).toBeInTheDocument();
    // Подпись — на середине пунктира.
    const [lat, lon] = JSON.parse(markers('gmd-gap-label')[0].dataset.position ?? '[]');
    expect(lat).toBeGreaterThan(track[1].lat);
    expect(lat).toBeLessThan(track[2].lat);
    expect(lon).toBeCloseTo(37.61, 6);
  });

  it('долгая стоянка на месте (> 5 мин, < 300 м) — не разрыв', () => {
    render(<TrackPolyline items={[at(0, 0), at(45, 0.001), at(46, 0.002)]} />);
    expect(solid()).toHaveLength(1);
    expect(dashed()).toHaveLength(0);
    expect(screen.queryByText(/нет данных/)).not.toBeInTheDocument();
  });

  it('одиночная точка между разрывами — без линии, но с маркером', () => {
    const lone = at(20, 0.02);
    const track = [at(0, 0), at(1, 0.001), lone, at(90, 0.05), at(91, 0.051)];
    render(<TrackPolyline items={track} />);
    expect(solid()).toHaveLength(2);
    expect(dashed()).toHaveLength(2);
    expect(screen.getByText('нет данных 19 мин')).toBeInTheDocument();
    expect(screen.getByText('нет данных 1 ч 10 мин')).toBeInTheDocument();
    const lonePos = JSON.stringify([lone.lat, lone.lon]);
    expect(markers('gmd-dot').some((m) => m.dataset.position === lonePos)).toBe(true);
  });

  it('одиночная точка не теряется при прореживании кружков (> 120 точек)', () => {
    // 61 точка + одиночная (индекс 61) + 70 точек = 132 → шаг выборки 2,
    // нечётный индекс одиночной точки в выборку сам не попадает.
    const head = Array.from({ length: 61 }, (_, i) => at(i, i * 0.0001));
    const lone = at(100, 0.03);
    const tail = Array.from({ length: 70 }, (_, i) => at(200 + i, 0.08 + i * 0.0001));
    render(<TrackPolyline items={[...head, lone, ...tail]} />);
    expect(dashed()).toHaveLength(2);
    const lonePos = JSON.stringify([lone.lat, lone.lon]);
    expect(markers('gmd-dot').some((m) => m.dataset.position === lonePos)).toBe(true);
  });
});
