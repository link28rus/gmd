/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import type { Zone, ZoneEvent } from '@/lib/api/zones';
import { ZoneEventsFeed } from '@/app/cabinet/zones/components/zone-events-feed';

const mockUseZoneEvents = jest.fn();
jest.mock('@/lib/hooks/use-zone-events', () => ({
  useZoneEvents: (...args: unknown[]) => mockUseZoneEvents(...args),
}));

function zone(id: string, name: string, arrival: Zone['arrival']): Zone {
  return {
    id,
    familyId: 'f1',
    name,
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
    myPrefs: [],
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function event(p: Partial<ZoneEvent> & Pick<ZoneEvent, 'id' | 'type' | 'zoneId'>): ZoneEvent {
  return {
    zoneName: 'Школа',
    zoneColor: '#22c55e',
    zoneIcon: 'school',
    childId: 'c1',
    childName: 'Аня',
    lat: 0,
    lon: 0,
    accuracy: null,
    recordedAt: '2026-09-29T00:00:00.000Z',
    createdAt: '2026-09-29T00:00:00.000Z',
    durationSec: null,
    ...p,
  };
}

function withEvents(items: ZoneEvent[]) {
  mockUseZoneEvents.mockReturnValue({
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    isFetchingNextPage: false,
  });
}

const KIDS = [{ id: 'c1', name: 'Аня' }];

describe('ZoneEventsFeed — события «не пришёл к сроку»', () => {
  it('missed_arrival: время срока берётся из зоны', () => {
    withEvents([event({ id: 'e1', type: 'missed_arrival', zoneId: 'z1' })]);
    render(
      <ZoneEventsFeed
        kids={KIDS}
        zones={[zone('z1', 'Школа', { deadlineMin: 510, daysMask: 31, graceMin: 10 })]}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Аня — не пришёл(а) к 08:30 в «Школа»');
  });

  it('missed_arrival: зоны нет в списке — без времени', () => {
    withEvents([event({ id: 'e1', type: 'missed_arrival', zoneId: 'gone' })]);
    render(<ZoneEventsFeed kids={KIDS} zones={[]} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('Аня — не пришёл(а) в «Школа»');
  });

  it('no_data', () => {
    withEvents([event({ id: 'e1', type: 'no_data', zoneId: 'z1' })]);
    render(<ZoneEventsFeed kids={KIDS} zones={[zone('z1', 'Школа', null)]} />);
    expect(screen.getByRole('listitem')).toHaveTextContent(
      'Аня — нет данных от телефона к сроку «Школа»',
    );
  });

  it('entry и exit рендерятся как раньше', () => {
    withEvents([
      event({ id: 'e1', type: 'exit', zoneId: 'z1', durationSec: 5400 }),
      event({ id: 'e2', type: 'entry', zoneId: 'z1' }),
    ]);
    render(<ZoneEventsFeed kids={KIDS} zones={[]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Аня — выход из «Школа» · пробыл(а) 1 ч 30 мин');
    expect(rows[1]).toHaveTextContent('Аня — вход в «Школа»');
  });
});
