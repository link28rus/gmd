/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { LatestMarker } from '@/components/locations/latest-marker';

describe('LatestMarker', () => {
  it('marker + accuracy-circle feature', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={10} childName="Иван" ageSec={30} />);
    const marker = screen.getByTestId('marker');
    expect(marker.getAttribute('data-coords')).toContain('37.61');
    const feature = screen.getByTestId('feature');
    expect(feature.getAttribute('data-type')).toBe('Polygon');
  });

  it('без accuracy — без feature', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" ageSec={0} />);
    expect(screen.getByTestId('marker')).toBeInTheDocument();
    expect(screen.queryByTestId('feature')).not.toBeInTheDocument();
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
});
