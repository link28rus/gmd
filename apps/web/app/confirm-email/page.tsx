'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';
import { AuthMapBackground } from '@/components/auth/auth-map-background';

interface ConfirmResponse {
  accessToken: string;
  user: AuthUser;
  family: AuthFamily;
}

interface ErrorResponse {
  error?: { code?: string; message?: string };
}

type Status = 'loading' | 'success' | 'error';

export default function ConfirmEmailPage(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAll = useAuthStore((s) => s.setAll);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // StrictMode в dev-режиме монтирует компонент дважды — защищаемся
  // от двойного POST /confirm-email, иначе второй запрос получит
  // token_consumed и испортит UX.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setErrorMsg('Ссылка некорректна — отсутствует токен подтверждения.');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/auth/confirm-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = (await res.json().catch(() => null)) as
          | (Partial<ConfirmResponse> & ErrorResponse)
          | null;
        if (res.status !== 200 || !json?.accessToken || !json.user || !json.family) {
          const code = json?.error?.code;
          if (code === 'token_expired') {
            setErrorMsg('Ссылка истекла. Зарегистрируйтесь заново, чтобы получить новое письмо.');
          } else if (code === 'token_consumed') {
            setErrorMsg('Эта ссылка уже использована. Войдите в аккаунт.');
          } else if (code === 'invalid_token') {
            setErrorMsg('Ссылка недействительна. Зарегистрируйтесь заново.');
          } else {
            setErrorMsg(json?.error?.message ?? 'Не удалось подтвердить почту');
          }
          setStatus('error');
          return;
        }
        setAll({
          accessToken: json.accessToken,
          user: json.user,
          family: json.family,
        });
        setStatus('success');
        router.replace('/cabinet');
      } catch {
        setErrorMsg('Не удалось соединиться с сервером');
        setStatus('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050a15] text-slate-100">
      <AuthMapBackground />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div
          className="w-full max-w-sm rounded-xl border border-slate-700/60 bg-slate-900/70 p-8 text-center shadow-2xl backdrop-blur-xl"
          style={{ animation: 'fade-up 0.6s ease-out both' }}
        >
          {status === 'loading' && (
            <>
              <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
              <h2 className="mb-1 text-lg font-semibold text-white">Подтверждаем почту…</h2>
              <p className="text-sm text-slate-400">Секундочку, сейчас войдёте в кабинет.</p>
            </>
          )}

          {status === 'success' && (
            <>
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
              <h2 className="mb-1 text-lg font-semibold text-white">Почта подтверждена</h2>
              <p className="text-sm text-slate-400">Перенаправляем в кабинет…</p>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-300 ring-1 ring-red-500/30">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h2 className="mb-2 text-lg font-semibold text-white">Подтвердить не удалось</h2>
              <p className="mb-6 text-sm text-slate-300">{errorMsg}</p>
              <div className="flex flex-col gap-2">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
                >
                  Зарегистрироваться
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-950/60 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-sky-400/50 hover:text-white"
                >
                  Войти
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
