/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { LatestMarker } from '@/components/locations/latest-marker';

describe('LatestMarker', () => {
  it('marker + accuracy-circle feature', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={10} childName="Иван" />);
    const marker = screen.getByTestId('marker');
    expect(marker.getAttribute('data-coords')).toContain('37.61');
    const feature = screen.getByTestId('feature');
    expect(feature.getAttribute('data-type')).toBe('Polygon');
  });

  it('без accuracy — без feature', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" />);
    expect(screen.getByTestId('marker')).toBeInTheDocument();
    expect(screen.queryByTestId('feature')).not.toBeInTheDocument();
  });

  it('первая буква имени', () => {
    render(<LatestMarker lat={55.75} lon={37.61} accuracy={null} childName="Иван" />);
    expect(screen.getByText('И')).toBeInTheDocument();
  });
});
