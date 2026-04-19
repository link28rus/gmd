/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateSelector } from '@/components/locations/date-selector';
import { todayIso, daysAgoIso } from '@/lib/date/day-bounds';

describe('DateSelector', () => {
  it('клик Сегодня → onChange(today)', async () => {
    const onChange = jest.fn();
    render(<DateSelector value={daysAgoIso(5)} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    expect(onChange).toHaveBeenCalledWith(todayIso());
  });

  it('клик Вчера → onChange(daysAgo(1))', async () => {
    const onChange = jest.fn();
    render(<DateSelector value={todayIso()} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Вчера' }));
    expect(onChange).toHaveBeenCalledWith(daysAgoIso(1));
  });

  it('aria-pressed на активном чипе', () => {
    render(<DateSelector value={todayIso()} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Сегодня' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Вчера' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('min/max у input — retention 30 дней', () => {
    render(<DateSelector value={todayIso()} onChange={() => {}} />);
    const input = screen.getByLabelText('Дата трека') as HTMLInputElement;
    expect(input.max).toBe(todayIso());
    expect(input.min).toBe(daysAgoIso(30));
  });
});
