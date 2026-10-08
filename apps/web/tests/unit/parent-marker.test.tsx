/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { ParentMarker } from '@/components/locations/parent-marker';

// См. latest-marker.test.tsx: react-leaflet мокаем простыми div'ами.
jest.mock('react-leaflet', () => {
  const React = require('react');
  return {
    Circle: ({ center, radius }: any) =>
      React.createElement('div', {
        'data-testid': 'accuracy-circle',
        'data-center': JSON.stringify(center),
        'data-radius': String(radius),
      }),
    Marker: ({ position, icon, children }: any) =>
      React.createElement(
        'div',
        { 'data-testid': 'marker', 'data-position': JSON.stringify(position) },
        React.createElement('div', {
          'data-testid': 'icon',
          dangerouslySetInnerHTML: { __html: icon?.options?.html ?? '' },
        }),
        children,
      ),
    Tooltip: ({ children }: any) =>
      React.createElement('div', { 'data-testid': 'tooltip' }, children),
  };
});

describe('ParentMarker', () => {
  it('имя, инициал, возраст и круг точности', () => {
    render(
      <ParentMarker lat={55.7} lon={37.6} accuracy={25} name="Анна" ageSec={120} isMe={false} />,
    );
    const icon = screen.getByTestId('icon');
    expect(icon.textContent).toContain('А');
    expect(icon.textContent).toContain('Анна');
    expect(icon.textContent).toContain('2 мин назад');
    expect(screen.getByTestId('accuracy-circle').dataset.radius).toBe('25');
    expect(icon.querySelector('[data-stale="0"]')).not.toBeNull();
  });

  it('своя метка подписана «Вы»', () => {
    render(<ParentMarker lat={55.7} lon={37.6} accuracy={null} name="Анна" ageSec={5} isMe />);
    expect(screen.getByTestId('icon').textContent).toContain('Вы');
    expect(screen.queryByTestId('accuracy-circle')).not.toBeInTheDocument();
  });

  it('старше 10 минут — серая', () => {
    render(
      <ParentMarker lat={55.7} lon={37.6} accuracy={null} name="Анна" ageSec={601} isMe={false} />,
    );
    expect(screen.getByTestId('icon').querySelector('[data-stale="1"]')).not.toBeNull();
  });

  it('имя экранируется в HTML иконки', () => {
    render(
      <ParentMarker
        lat={55.7}
        lon={37.6}
        accuracy={null}
        name="<b>Анна</b>"
        ageSec={5}
        isMe={false}
      />,
    );
    expect(screen.getByTestId('icon').querySelector('b')).toBeNull();
  });
});
