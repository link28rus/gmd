/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { TrackTruncatedBanner } from '@/components/locations/track-truncated-banner';

test('role=status + нужный текст', () => {
  render(<TrackTruncatedBanner />);
  const el = screen.getByRole('status');
  expect(el).toHaveTextContent('Трек обрезан до 2000 точек');
});
