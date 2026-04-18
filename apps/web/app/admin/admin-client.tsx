'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';

interface RefreshResponse {
  accessToken: string;
  user?: AuthUser & { isAdmin?: boolean };
  family?: AuthFamily;
}

interface Props {
  children: ReactNode;
}

export function AdminClient({ children }: Props) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const family = useAuthStore((s) => s.family);
  const setAll = useAuthStore((s) => s.setAll);

  const [bootstrapping, setBootstrapping] = useState(accessToken === null);

  useEffect(() => {
    if (accessToken !== null && user !== null && family !== null) {
      // Already have tokens — check isAdmin
      if (!user.isAdmin) {
        router.replace('/cabinet');
      } else {
        setBootstrapping(false);
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST' });
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const data = (await res.json()) as RefreshResponse;
        if (cancelled) return;
        if (!data.user || !data.family) {
          router.replace('/login');
          return;
        }
        setAll({ accessToken: data.accessToken, user: data.user, family: data.family });
        if (!data.user.isAdmin) {
          router.replace('/cabinet');
          return;
        }
      } catch {
        router.replace('/login');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bootstrapping) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-zinc-500">Загружаем…</p>
      </div>
    );
  }

  return <>{children}</>;
}
