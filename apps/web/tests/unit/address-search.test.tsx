/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AddressSearch } from '@/app/cabinet/zones/components/address-search';

jest.mock('@/lib/api/geocode', () => ({
  geocode: jest
    .fn()
    .mockResolvedValue([
      { name: 'Хабаровск, Ленина 23', description: 'Хабаровский край', lat: 48.48, lon: 135.08 },
    ]),
}));

describe('AddressSearch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('показывает подсказки после ввода и вызывает onPick', async () => {
    const onPick = jest.fn();
    const onChange = jest.fn();

    render(<AddressSearch value="Хабаровск" onChange={onChange} onPick={onPick} />);

    // advance past the 400ms debounce
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => expect(screen.getByText('Хабаровск, Ленина 23')).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByText('Хабаровск, Ленина 23'));

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ lat: 48.48, lon: 135.08 }));
  });
});
