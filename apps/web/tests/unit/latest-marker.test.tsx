/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { LatestMarker } from '@/components/locations/latest-marker';

// react-leaflet — ESM и без <MapContainer> не рендерится; мокаем слои
// простыми div'ами с нужными для проверки атрибутами. HTML DivIcon'а
// вставляем в DOM, чтобы проверять содержимое маркера по тексту.
jest.mock('react-leaflet', () => {
  const React = require('react');
  return {
    Circle: ({ center, radius }: any) =>
      React.createElement('div', {
        'data-testid': 'accuracy-circle',
        'data-center': JSON.stringify(center),
        'data-radius': String(radius),
      }),
    Marker: ({ position, icon, eventHandlers }: any) =>
      React.createElement('div', {
        'data-testid': 'marker',
        'data-position': JSON.stringify(position),
        onClick: eventHandlers?.click,
        dangerouslySetInnerHTML: { __html: icon?.options?.html ?? '' },
      }),
  };
});

describe('LatestMarker', () => {
  it('маркер + круг точности вокруг точки', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={10} childName="Иван" ageSec={30} />);
    expect(screen.getByTestId('marker').dataset.position).toBe(JSON.stringify([55.75, 37.61]));
    const circle = screen.getByTestId('accuracy-circle');
    expect(circle.dataset.center).toBe(JSON.stringify([55.75, 37.61]));
    expect(circle.dataset.radius).toBe('10');
  });

  it('без accuracy — без круга точности', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" ageSec={0} />);
    expect(screen.getByTestId('marker')).toBeInTheDocument();
    expect(screen.queryByTestId('accuracy-circle')).not.toBeInTheDocument();
  });

  it('первая буква имени и имя в плашке', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" ageSec={5} />);
    expect(screen.getByText('И')).toBeInTheDocument();
    // плашка с именем
    expect(screen.getByText('Иван')).toBeInTheDocument();
  });

  it('плашка возраста — «был тут»', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" ageSec={180} />);
    expect(screen.getByText(/Был тут .* мин назад/)).toBeInTheDocument();
  });

  it('имя экранируется в HTML иконки', () => {
    render(
      <LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="<b>Иван</b>" ageSec={5} />,
    );
    expect(screen.getByTestId('marker').querySelector('b')).toBeNull();
    expect(screen.getByText('<b>Иван</b>')).toBeInTheDocument();
  });

  it('с avatarUrl — картинка вместо буквы', () => {
    render(
      <LatestMarker
        lat={55.75}
        lon={37.61}
        accuracy={null}
        childName="Иван"
        ageSec={5}
        avatarUrl="/avatars/fox.svg"
      />,
    );
    const img = screen.getByTestId('marker').querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/avatars/fox.svg');
    expect(screen.queryByText('И')).not.toBeInTheDocument();
  });

  it('avatarUrl экранируется в атрибуте src', () => {
    render(
      <LatestMarker
        lat={55.75}
        lon={37.61}
        accuracy={null}
        childName="Иван"
        ageSec={5}
        avatarUrl={'x" onerror="alert(1)'}
      />,
    );
    const img = screen.getByTestId('marker').querySelector('img');
    expect(img?.getAttribute('src')).toBe('x" onerror="alert(1)');
    expect(img?.hasAttribute('onerror')).toBe(false);
  });

  it('свежая точка (≤ 10 мин) — не серая', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" ageSec={600} />);
    expect(screen.getByTestId('marker').querySelector('[data-stale="0"]')).not.toBeNull();
  });

  it('точка старше 10 минут — серая метка', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" ageSec={601} />);
    expect(screen.getByTestId('marker').querySelector('[data-stale="1"]')).not.toBeNull();
  });

  it('onClick — клик по маркеру', () => {
    const onClick = jest.fn();
    render(
      <LatestMarker
        lat={55.75}
        lon={37.61}
        accuracy={null}
        childName="Иван"
        ageSec={5}
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('marker'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
