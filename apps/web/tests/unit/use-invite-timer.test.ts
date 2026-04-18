// apps/web/tests/unit/use-invite-timer.test.ts
import { renderHook, act } from '@testing-library/react';
import { useInviteTimer } from '@/lib/hooks/use-invite-timer';

describe('useInviteTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('форматирует оставшееся время mm:ss', () => {
    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 min
    jest.setSystemTime(now);
    const { result } = renderHook(() => useInviteTimer(expiresAt));
    expect(result.current.formatted).toBe('10:00');
    expect(result.current.expired).toBe(false);
  });

  it('тикает каждую секунду', () => {
    const now = Date.now();
    jest.setSystemTime(now);
    const { result } = renderHook(() => useInviteTimer(now + 5000));
    expect(result.current.formatted).toBe('00:05');
    act(() => {
      jest.setSystemTime(now + 2000);
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.formatted).toBe('00:03');
  });

  it('expired=true когда время истекло', () => {
    const now = Date.now();
    jest.setSystemTime(now);
    const { result } = renderHook(() => useInviteTimer(now - 1000));
    expect(result.current.expired).toBe(true);
    expect(result.current.formatted).toBe('00:00');
  });

  it('null-expiresAt → expired=true, formatted="--:--"', () => {
    const { result } = renderHook(() => useInviteTimer(null));
    expect(result.current.expired).toBe(true);
    expect(result.current.formatted).toBe('--:--');
  });
});
