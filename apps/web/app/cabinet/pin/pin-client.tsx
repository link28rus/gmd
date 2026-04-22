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

interface PinStatus {
  isSet: boolean;
  updatedAt: string | null;
}

const PIN_MIN = 4;
const PIN_MAX = 8;
const PIN_RE = /^\d{4,8}$/;

type Mode = 'set' | 'change' | 'delete';

export default function PinClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setAll = useAuthStore((s) => s.setAll);
  const patchUser = useAuthStore((s) => s.patchUser);

  const [bootstrapping, setBootstrapping] = useState(accessToken === null);
  const [status, setStatus] = useState<PinStatus | null>(null);
  const [mode, setMode] = useState<Mode>('set');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
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

  useEffect(() => {
    if (!accessToken) return;
    void refreshStatus(accessToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function refreshStatus(token: string): Promise<void> {
    try {
      const res = await fetch('/api/me/pin', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as PinStatus;
        setStatus(data);
        setMode(data.isSet ? 'change' : 'set');
        patchUser({ hasPin: data.isSet });
      }
    } catch {
      /* ignore */
    }
  }

  function validateNewPin(): string | null {
    if (!PIN_RE.test(newPin)) return `PIN — от ${PIN_MIN} до ${PIN_MAX} цифр`;
    if (newPin !== confirmPin) return 'PIN не совпадают';
    if (mode === 'change' && !PIN_RE.test(currentPin)) return 'Введите текущий PIN';
    return null;
  }

  async function onSetOrChange(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const err = validateNewPin();
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
      const body: Record<string, string> = { newPin };
      if (mode === 'change') body.currentPin = currentPin;
      const res = await fetch('/api/me/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as {
        isSet?: boolean;
        updatedAt?: string | null;
        error?: { message?: string; code?: string };
        message?: string;
      } | null;
      if (res.ok && data?.isSet) {
        setStatus({ isSet: true, updatedAt: data.updatedAt ?? new Date().toISOString() });
        setMode('change');
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        patchUser({ hasPin: true });
        toast.success(mode === 'set' ? 'PIN установлен' : 'PIN обновлён');
        return;
      }
      if (res.status === 401) {
        const code = data?.error?.code;
        toast.error(code === 'invalid_pin' ? 'Неверный текущий PIN' : 'Сессия не активна');
        return;
      }
      if (res.status === 429) {
        toast.error('Слишком много попыток — попробуйте позже');
        return;
      }
      toast.error(data?.error?.message ?? data?.message ?? 'Не удалось сохранить PIN');
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (!accessToken) {
      toast.error('Сессия не активна');
      return;
    }
    if (!PIN_RE.test(currentPin)) {
      toast.error('Введите текущий PIN');
      return;
    }
    if (!confirm('Удалить PIN? Это выключит защиту от удаления на всех устройствах детей.')) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/me/pin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ currentPin }),
      });
      if (res.status === 204) {
        setStatus({ isSet: false, updatedAt: null });
        setMode('set');
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        patchUser({ hasPin: false });
        toast.success('PIN удалён. Защита на устройствах детей выключена.');
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      if (res.status === 401) {
        toast.error(
          data?.error?.code === 'invalid_pin' ? 'Неверный текущий PIN' : 'Сессия не активна',
        );
        return;
      }
      if (res.status === 429) {
        toast.error('Слишком много попыток — попробуйте позже');
        return;
      }
      toast.error(data?.error?.message ?? 'Не удалось удалить PIN');
    } catch {
      toast.error('Сетевая ошибка');
    } finally {
      setSubmitting(false);
    }
  }

  if (bootstrapping) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-zinc-500">Загружаем…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-zinc-500">Сессия не активна</p>
      </div>
    );
  }

  const isSet = status?.isSet ?? false;

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-4 text-sm">
        <Link href="/cabinet" className="text-zinc-500 hover:text-zinc-900">
          ← В кабинет
        </Link>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-zinc-900">PIN родителя</h1>
        <p className="mb-6 text-sm text-zinc-600">
          Один PIN для всех защищённых действий: подтверждение отключения защиты на устройстве
          ребёнка, блокировка приложения родителя, снятие отвязки устройства. 4–8 цифр.
        </p>

        {isSet && status?.updatedAt && (
          <div className="mb-6 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            PIN установлен · обновлён {new Date(status.updatedAt).toLocaleString('ru-RU')}
          </div>
        )}

        {(mode === 'set' || mode === 'change') && (
          <form onSubmit={onSetOrChange} className="space-y-4">
            {mode === 'change' && (
              <div>
                <label htmlFor="cur" className="mb-1 block text-sm font-medium text-zinc-700">
                  Текущий PIN
                </label>
                <input
                  id="cur"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{4,8}"
                  minLength={PIN_MIN}
                  maxLength={PIN_MAX}
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  disabled={submitting}
                  autoComplete="current-password"
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm tracking-widest text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-100"
                  required
                />
              </div>
            )}
            <div>
              <label htmlFor="new" className="mb-1 block text-sm font-medium text-zinc-700">
                {mode === 'set' ? 'Новый PIN' : 'Новый PIN'}
              </label>
              <input
                id="new"
                type="password"
                inputMode="numeric"
                pattern="\d{4,8}"
                minLength={PIN_MIN}
                maxLength={PIN_MAX}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                disabled={submitting}
                autoComplete="new-password"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm tracking-widest text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-100"
                required
              />
              <p className="mt-1 text-xs text-zinc-500">
                От {PIN_MIN} до {PIN_MAX} цифр.
              </p>
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-zinc-700">
                Повторите PIN
              </label>
              <input
                id="confirm"
                type="password"
                inputMode="numeric"
                pattern="\d{4,8}"
                minLength={PIN_MIN}
                maxLength={PIN_MAX}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                disabled={submitting}
                autoComplete="new-password"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm tracking-widest text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-100"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {submitting ? 'Сохраняем…' : mode === 'set' ? 'Установить PIN' : 'Сменить PIN'}
            </button>
          </form>
        )}

        {isSet && (
          <div className="mt-6 border-t border-zinc-200 pt-6">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">Удаление PIN</h2>
            <p className="mb-3 text-xs text-zinc-600">
              Отключит защиту на всех устройствах детей. Введите текущий PIN для подтверждения.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{4,8}"
                minLength={PIN_MIN}
                maxLength={PIN_MAX}
                placeholder="Текущий PIN"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                disabled={submitting}
                autoComplete="current-password"
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm tracking-widest text-zinc-900 focus:border-zinc-900 focus:outline-none disabled:bg-zinc-100"
              />
              <button
                type="button"
                onClick={onDelete}
                disabled={submitting}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                Удалить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
