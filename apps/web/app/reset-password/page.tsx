'use client';

import { Suspense, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthMapBackground } from '@/components/auth/auth-map-background';

interface ErrorResponse {
  error?: { code?: string; message?: string };
}

const INPUT_CLASS =
  'w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20';

const PRIMARY_BTN =
  'w-full rounded-md bg-sky-500 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(56,189,248,0.4),0_8px_24px_-8px_rgba(56,189,248,0.6)] transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-sky-500';

export default function ResetPasswordPage(): ReactElement {
  return (
    <Suspense fallback={<ResetPasswordSkeleton />}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordSkeleton(): ReactElement {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050a15] text-slate-100">
      <AuthMapBackground />
      <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-slate-700/60 bg-slate-900/70 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
        </div>
      </main>
    </div>
  );
}

function ResetPasswordInner(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('Ссылка некорректна — отсутствует токен.');
      return;
    }
    if (password.length < 8) {
      setError('Пароль не короче 8 символов');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Пароли не совпадают');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.status === 200) {
        setDone(true);
        setTimeout(() => router.replace('/login'), 2500);
        return;
      }
      const json = (await res.json().catch(() => null)) as ErrorResponse | null;
      const code = json?.error?.code;
      if (code === 'token_expired') {
        setError('Ссылка истекла. Попросите администратора прислать новую.');
      } else if (code === 'token_consumed') {
        setError('Эта ссылка уже была использована.');
      } else if (code === 'invalid_token') {
        setError('Ссылка недействительна.');
      } else {
        setError(json?.error?.message ?? 'Не удалось сменить пароль');
      }
    } catch {
      setError('Не удалось соединиться с сервером');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050a15] text-slate-100">
      <AuthMapBackground />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div
          className="w-full max-w-sm rounded-xl border border-slate-700/60 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl"
          style={{ animation: 'fade-up 0.6s ease-out both' }}
        >
          {done ? (
            <div className="py-4 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 className="mb-1 text-lg font-semibold text-white">Пароль изменён</h2>
              <p className="text-sm text-slate-400">Перенаправляем на страницу входа…</p>
            </div>
          ) : (
            <>
              <h1 className="mb-1 text-center text-2xl font-semibold text-white">Новый пароль</h1>
              <p className="mb-6 text-center text-xs text-slate-400">
                Введите новый пароль для вашего аккаунта Перископ
              </p>

              <form onSubmit={submit} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-300">Пароль</span>
                  <input
                    type="password"
                    autoFocus
                    required
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="••••••••"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-300">
                    Повторите пароль
                  </span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="••••••••"
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading || password.length < 8 || password !== passwordConfirm}
                  className={PRIMARY_BTN}
                >
                  {loading ? 'Сохраняем…' : 'Сохранить и войти'}
                </button>
              </form>

              <p className="mt-5 text-center text-xs text-slate-500">
                Вспомнили старый пароль?{' '}
                <Link href="/login" className="font-medium text-sky-300 hover:text-sky-200">
                  Войти
                </Link>
              </p>

              {error && (
                <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
