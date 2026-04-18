// apps/web/lib/hooks/use-invite-timer.ts
'use client';

import { useEffect, useState } from 'react';

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export interface InviteTimerState {
  formatted: string;
  expired: boolean;
  secondsLeft: number;
}

function fromSeconds(s: number): InviteTimerState {
  if (s <= 0) return { formatted: '00:00', expired: true, secondsLeft: 0 };
  return {
    formatted: `${pad(Math.floor(s / 60))}:${pad(s % 60)}`,
    expired: false,
    secondsLeft: s,
  };
}

export function useInviteTimer(expiresAt: number | null): InviteTimerState {
  const computeInitial = (): InviteTimerState => {
    if (expiresAt == null) return { formatted: '--:--', expired: true, secondsLeft: 0 };
    const ms = expiresAt - Date.now();
    if (ms <= 0) return { formatted: '00:00', expired: true, secondsLeft: 0 };
    return fromSeconds(Math.floor(ms / 1000));
  };

  const [state, setState] = useState<InviteTimerState>(computeInitial);

  useEffect(() => {
    const initial = computeInitial();
    setState(initial);
    if (expiresAt == null || initial.expired) return;

    const id = setInterval(() => {
      setState((prev) => {
        const next = prev.secondsLeft - 1;
        return fromSeconds(next);
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  return state;
}
