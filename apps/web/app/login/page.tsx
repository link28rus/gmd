'use client';

import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, type AuthUser, type AuthFamily } from '@/lib/auth-store';

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

export default function LoginPage(): ReactElement {
  const router = useRouter();
  const setAll = useAuthStore((s) => s.setAll);

  const [mode, setMode] = useState<LoginMode>('otp');
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: LoginMode): void {
    setMode(next);
    setError(null);
    setPassword('');
    setCode('');
  }

  async function requestOtp(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
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
      if (res.status !== 202) {
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
        if (
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-zinc-900">Вход в GMD</h1>

        {/* Mode switcher */}
        <div className="mb-6 flex rounded-md border border-zinc-200 p-1">
          <button
            type="button"
            onClick={() => switchMode('otp')}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
              mode === 'otp' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            По коду из письма
          </button>
          <button
            type="button"
            onClick={() => switchMode('password')}
            className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
              mode === 'password' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            По паролю
          </button>
        </div>

        {mode === 'otp' ? (
          stage === 'email' ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700">Email</span>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                  placeholder="you@example.com"
                />
              </label>
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {loading ? 'Отправляем…' : 'Получить код'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-4">
              <p className="text-sm text-zinc-600">
                Код отправлен на <b className="text-zinc-900">{email}</b>
              </p>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700">Код из письма</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-center text-lg tracking-widest focus:border-zinc-900 focus:outline-none"
                  placeholder="123456"
                />
              </label>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
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
                className="block w-full text-center text-xs text-zinc-500 hover:text-zinc-900"
              >
                ← Изменить email / отправить код снова
              </button>
            </form>
          )
        ) : (
          <form onSubmit={loginWithPassword} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-700">Email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                placeholder="you@example.com"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-zinc-700">Пароль</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
                placeholder="••••••••"
              />
            </label>
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? 'Входим…' : 'Войти'}
            </button>
            <button
              type="button"
              onClick={() => switchMode('otp')}
              className="block w-full text-center text-xs text-zinc-500 hover:text-zinc-900"
            >
              Забыли пароль? Войти по коду из письма
            </button>
          </form>
        )}

        {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
