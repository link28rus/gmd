/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { StaleIndicator } from '@/components/locations/stale-indicator';

describe('StaleIndicator', () => {
  it('зелёный < 60 сек', () => {
    render(<StaleIndicator ageSec={30} accuracy={8} batteryLevel={73} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('30 сек назад');
    expect(el.className).toContain('bg-green-50');
  });

  it('серый 60..299', () => {
    render(<StaleIndicator ageSec={120} accuracy={null} batteryLevel={null} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('2 мин назад');
    expect(el.className).toContain('bg-zinc-50');
  });

  it('жёлтый 300..1799', () => {
    render(<StaleIndicator ageSec={600} accuracy={null} batteryLevel={null} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Давно не обновлялось: 10 мин');
    expect(el.className).toContain('bg-yellow-50');
  });

  it('красный >= 1800', () => {
    render(<StaleIndicator ageSec={3600} accuracy={null} batteryLevel={null} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Устройство не выходило на связь: 60 мин');
    expect(el.className).toContain('bg-red-50');
  });

  it('accuracy и battery', () => {
    render(<StaleIndicator ageSec={5} accuracy={12} batteryLevel={50} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('±12 м');
    expect(el).toHaveTextContent('50%');
  });
});
