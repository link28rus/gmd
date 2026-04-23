'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';

interface RefreshResponse {
  accessToken: string;
  user?: AuthUser;
  family?: AuthFamily;
}

const MIN_LEN = 8;
const MAX_LEN = 128;

export default function PasswordClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setAll = useAuthStore((s) => s.setAll);
  const patchUser = useAuthStore((s) => s.patchUser);

  const [bootstrapping, setBootstrapping] = useState(accessToken === null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (accessToken !== null && user !== null) {
      setBootstrapping(false);
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

  const hasPassword = user?.hasPassword === true;

  function validate(): string | null {
    if (password.length < MIN_LEN) return `Минимум ${MIN_LEN} символов`;
    if (password.length > MAX_LEN) return `Максимум ${MAX_LEN} символов`;
    if (password !== confirm) return 'Пароли не совпадают';
    return null;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (!accessToken) {
      toast.error('Сессия не активна');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
      });
      if (res.status === 204) {
        patchUser({ hasPassword: true });
        setPassword('');
        setConfirm('');
        toast.success(hasPassword ? 'Пароль обновлён' : 'Пароль установлен');
        return;
      }
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        message?: string;
        error?: { message?: string };
      } | null;
      toast.error(data?.error?.message ?? data?.message ?? 'Не удалось сохранить пароль');
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setSubmitting(false);
    }
  }

  if (bootstrapping) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">Загружаем…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-muted-foreground">Сессия не активна</p>
      </div>
    );
  }

  const title = hasPassword ? 'Сменить пароль' : 'Установить пароль';
  const subtitle = hasPassword
    ? 'Обновите постоянный пароль для входа. Текущий пароль будет заменён.'
    : 'Установите постоянный пароль, чтобы входить без одноразового кода из письма.';

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-4 text-sm">
        <Link href="/cabinet" className="text-muted-foreground hover:text-foreground">
          ← В кабинет
        </Link>
      </div>
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="pwd" className="mb-1 block text-sm font-medium text-foreground">
              Новый пароль
            </label>
            <input
              id="pwd"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LEN}
              maxLength={MAX_LEN}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-zinc-900 focus:outline-none disabled:bg-muted"
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">
              От {MIN_LEN} до {MAX_LEN} символов.
            </p>
          </div>
          <div>
            <label htmlFor="pwd2" className="mb-1 block text-sm font-medium text-foreground">
              Подтвердите пароль
            </label>
            <input
              id="pwd2"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LEN}
              maxLength={MAX_LEN}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-zinc-900 focus:outline-none disabled:bg-muted"
              required
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-foreground py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {submitting ? 'Сохраняем…' : title}
          </button>
        </form>
      </div>
    </div>
  );
}
