'use client';

import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';
import { AuthMapBackground } from '@/components/auth/auth-map-background';

type Stage = 'email' | 'otp';
type LoginMode = 'otp' | 'password';

interface VerifyResponse {
  accessToken: string;
  user: AuthUser;
  family: AuthFamily;
}

interface ErrorResponse {
  error?: { code?: string; message?: string; retryAfterSec?: number };
}

export default function LoginClient(): ReactElement {
  const router = useRouter();
  const setAll = useAuthStore((s) => s.setAll);

  const [mode, setMode] = useState<LoginMode>('otp');
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Когда backend возвращает `user_not_found` или `email_not_verified`,
   *  отдельно показываем CTA на /register — это нагляднее, чем инлайн в тексте ошибки. */
  const [showRegisterCta, setShowRegisterCta] = useState(false);

  function switchMode(next: LoginMode): void {
    setMode(next);
    setError(null);
    setShowRegisterCta(false);
    setPassword('');
    setCode('');
  }

  async function requestOtp(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setShowRegisterCta(false);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        setError('Слишком много попыток, подождите минуту');
        return;
      }
      if (res.status === 404) {
        const json = (await res.json().catch(() => null)) as ErrorResponse | null;
        const code = json?.error?.code;
        if (code === 'user_not_found') {
          setError('Пользователь с такой почтой не найден');
          setShowRegisterCta(true);
        } else if (code === 'email_not_verified') {
          setError('Почта не подтверждена. Проверьте письмо или зарегистрируйтесь ещё раз');
          setShowRegisterCta(true);
        } else if (code === 'account_blocked') {
          setError('Аккаунт заблокирован. Обратитесь к администратору.');
        } else {
          setError(json?.error?.message ?? 'Пользователь не найден');
          setShowRegisterCta(true);
        }
        return;
      }
      if (res.status !== 200) {
        const json = (await res.json().catch(() => null)) as ErrorResponse | null;
        setError(json?.error?.message ?? 'Не удалось отправить код');
        return;
      }
      setStage('otp');
      setCode('');
    } catch {
      setError('Не удалось соединиться с сервером');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const json = (await res.json().catch(() => null)) as
        | (Partial<VerifyResponse> & ErrorResponse)
        | null;
      if (res.status !== 200 || !json || !json.accessToken || !json.user || !json.family) {
        const errCode = json?.error?.code;
        if (errCode === 'email_not_verified') {
          setError('Почта не подтверждена. Проверьте письмо');
          setShowRegisterCta(true);
        } else if (
          errCode === 'invalid_code' ||
          errCode === 'code_expired' ||
          errCode === 'code_consumed'
        ) {
          setError('Неверный код');
        } else if (res.status === 429) {
          setError('Слишком много попыток, подождите минуту');
        } else {
          setError(json?.error?.message ?? 'Не удалось войти');
        }
        return;
      }
      setAll({
        accessToken: json.accessToken,
        user: json.user,
        family: json.family,
      });
      router.push('/cabinet');
    } catch {
      setError('Не удалось соединиться с сервером');
    } finally {
      setLoading(false);
    }
  }

  async function loginWithPassword(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setShowRegisterCta(false);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json().catch(() => null)) as
        | (Partial<VerifyResponse> & ErrorResponse)
        | null;
      if (res.status === 200 && json?.accessToken && json.user && json.family) {
        setAll({
          accessToken: json.accessToken,
          user: json.user,
          family: json.family,
        });
        router.push('/cabinet');
        return;
      }
      const errCode = json?.error?.code;
      if (errCode === 'invalid_credentials') {
        setError('Неверный email или пароль');
      } else if (errCode === 'email_not_verified') {
        setError('Почта не подтверждена. Проверьте письмо');
        setShowRegisterCta(true);
      } else if (errCode === 'account_blocked') {
        setError('Аккаунт заблокирован. Обратитесь к администратору.');
      } else if (errCode === 'account_locked') {
        const mins = Math.ceil((json?.error?.retryAfterSec ?? 900) / 60);
        setError(`Аккаунт временно заблокирован. Попробуйте через ${mins} мин.`);
      } else if (res.status === 429) {
        setError('Слишком много попыток, подождите минуту');
      } else {
        setError(json?.error?.message ?? 'Не удалось войти');
      }
    } catch {
      setError('Не удалось соединиться с сервером');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20';
  const primaryBtnClass =
    'w-full rounded-md bg-sky-500 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(56,189,248,0.4),0_8px_24px_-8px_rgba(56,189,248,0.6)] transition hover:bg-sky-400 hover:shadow-[0_0_0_1px_rgba(125,211,252,0.5),0_12px_32px_-8px_rgba(56,189,248,0.8)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-sky-500';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050a15] text-slate-100">
      <AuthMapBackground />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div
          className="w-full max-w-sm rounded-xl border border-slate-700/60 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl"
          style={{ animation: 'fade-up 0.6s ease-out both' }}
        >
          <h1 className="mb-1 text-center text-2xl font-semibold text-white">Вход в Перископ</h1>
          <p className="mb-6 text-center text-xs text-slate-400">
            Родительский контроль и геолокация
          </p>

          <div className="mb-6 flex rounded-md border border-slate-700 bg-slate-950/40 p-1">
            <button
              type="button"
              onClick={() => switchMode('otp')}
              className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
                mode === 'otp'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              По коду из письма
            </button>
            <button
              type="button"
              onClick={() => switchMode('password')}
              className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
                mode === 'password'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              По паролю
            </button>
          </div>

          {mode === 'otp' ? (
            stage === 'email' ? (
              <form onSubmit={requestOtp} className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-300">Email</span>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                    placeholder="you@example.com"
                  />
                </label>
                <button type="submit" disabled={loading || !email} className={primaryBtnClass}>
                  {loading ? 'Отправляем…' : 'Получить код'}
                </button>
              </form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-4">
                <p className="text-sm text-slate-300">
                  Код отправлен на <b className="text-white">{email}</b>
                </p>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-300">
                    Код из письма
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className={`${inputClass} text-center text-lg tracking-[0.4em]`}
                    placeholder="123456"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className={primaryBtnClass}
                >
                  {loading ? 'Входим…' : 'Войти'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStage('email');
                    setCode('');
                    setError(null);
                  }}
                  className="block w-full text-center text-xs text-slate-400 hover:text-slate-200"
                >
                  ← Изменить email / отправить код снова
                </button>
              </form>
            )
          ) : (
            <form onSubmit={loginWithPassword} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-300">Email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@example.com"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-300">Пароль</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </label>
              <button
                type="submit"
                disabled={loading || !email || !password}
                className={primaryBtnClass}
              >
                {loading ? 'Входим…' : 'Войти'}
              </button>
              <button
                type="button"
                onClick={() => switchMode('otp')}
                className="block w-full text-center text-xs text-slate-400 hover:text-slate-200"
              >
                Забыли пароль? Войти по коду из письма
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-xs text-slate-500">
            Ещё нет аккаунта?{' '}
            <Link href="/register" className="font-medium text-sky-300 hover:text-sky-200">
              Зарегистрироваться
            </Link>
          </p>

          <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-500">
            Нажимая кнопку, вы принимаете{' '}
            <Link href="/privacy" className="underline hover:text-sky-300">
              Политику конфиденциальности
            </Link>{' '}
            и{' '}
            <Link href="/terms" className="underline hover:text-sky-300">
              Условия использования
            </Link>
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
              {showRegisterCta && (
                <div className="mt-2">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-1 font-medium text-sky-300 hover:text-sky-200"
                  >
                    → Зарегистрироваться
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
