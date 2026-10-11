'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { refreshAccessToken } from '@/lib/auth/refresh-singleflight';

const MIN_LEN = 8;
const MAX_LEN = 128;

export default function PasswordClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setAll = useAuthStore((s) => s.setAll);
  const patchUser = useAuthStore((s) => s.patchUser);
  const setAccess = useAuthStore((s) => s.setAccess);

  const [bootstrapping, setBootstrapping] = useState(accessToken === null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
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
        const data = await refreshAccessToken();
        if (cancelled) return;
        if (!data || !data.user || !data.family) {
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
    if (hasPassword && currentPassword.length === 0) return 'Введите текущий пароль';
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
    setCurrentError(null);
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(hasPassword ? { password, currentPassword } : { password }),
      });
      if (res.ok) {
        // Backend отозвал все сессии и выдал новую пару: refresh уже в cookie
        // (route-хендлер), access — сюда, иначе следующий запрос получит 401.
        const ok = (await res.json().catch(() => null)) as { accessToken?: string } | null;
        if (ok?.accessToken) setAccess(ok.accessToken);
        patchUser({ hasPassword: true });
        setCurrentPassword('');
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
        error?: { code?: string; message?: string };
      } | null;
      const code = data?.error?.code;
      if (code === 'invalid_current_password' || code === 'current_password_required') {
        const msg =
          code === 'invalid_current_password'
            ? 'Неверный текущий пароль'
            : 'Введите текущий пароль';
        // Флаг в store мог устареть (пароль задан в другой вкладке) — показать поле.
        if (!hasPassword) patchUser({ hasPassword: true });
        setCurrentError(msg);
        toast.error(msg);
        return;
      }
      if (res.status === 423) {
        toast.error('Слишком много неверных попыток. Попробуйте позже');
        return;
      }
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
    ? 'Обновите постоянный пароль для входа. На других устройствах и в других браузерах потребуется войти заново.'
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
          {hasPassword && (
            <div>
              <label htmlFor="pwd0" className="mb-1 block text-sm font-medium text-foreground">
                Текущий пароль
              </label>
              <input
                id="pwd0"
                type="password"
                autoComplete="current-password"
                maxLength={MAX_LEN}
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setCurrentError(null);
                }}
                disabled={submitting}
                aria-invalid={currentError !== null}
                aria-describedby={currentError ? 'pwd0-err' : undefined}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-zinc-900 focus:outline-none disabled:bg-muted"
                required
              />
              {currentError && (
                <p id="pwd0-err" className="mt-1 text-xs text-destructive">
                  {currentError}
                </p>
              )}
            </div>
          )}
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
