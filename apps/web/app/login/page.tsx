'use client';

import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import Link from 'next/link';
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

/**
 * 4 GPS-маркера с подписями мест. Позиции подобраны так, чтобы оставить
 * свободный центр под форму входа, а при slice-масштабировании SVG маркеры
 * оставались в видимой области даже на квадратных/мобильных окнах.
 * `labelWidth` задан вручную — SVG не умеет обернуть текст автоматически,
 * так что фоновые rect-подложки под подписями размечаются статически.
 */
const MARKERS: Array<{
  x: number;
  y: number;
  label: string;
  labelWidth: number;
  delay: number;
}> = [
  { x: 220, y: 185, label: 'Дом', labelWidth: 56, delay: 0 },
  { x: 1245, y: 225, label: 'Школа', labelWidth: 74, delay: 0.8 },
  { x: 1260, y: 695, label: 'Секция', labelWidth: 82, delay: 1.6 },
  { x: 195, y: 720, label: 'Бабушка', labelWidth: 94, delay: 2.4 },
];

/**
 * Декоративный фон-карта для страницы входа. Повторяет визуальный язык
 * landing'а, но с более извилистыми маршрутами (S-образные Безье) и
 * подписанными маркерами.
 */
function LoginMapBackground(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="centerGlow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="rgba(56,189,248,0.20)" />
          <stop offset="42%" stopColor="rgba(56,189,248,0.06)" />
          <stop offset="100%" stopColor="rgba(56,189,248,0)" />
        </radialGradient>
        <linearGradient id="roadGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(148,163,184,0)" />
          <stop offset="50%" stopColor="rgba(148,163,184,0.12)" />
          <stop offset="100%" stopColor="rgba(148,163,184,0)" />
        </linearGradient>
        <filter id="pinGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width="1440" height="900" fill="url(#centerGlow)" />

      {/* «Магистрали» — более извилистые, чем на landing: многократные
          S-образные cubic Bezier. Направление потока — от левого-верха
          к правому-низу с двумя сильными изгибами. */}
      <g fill="none" strokeLinecap="round">
        <path
          d="M -100 520 C 120 360, 320 640, 520 440 S 900 680, 1100 360 S 1320 560, 1600 440"
          stroke="url(#roadGrad)"
          strokeWidth="52"
        />
        <path
          d="M -100 320 C 200 520, 460 180, 720 380 S 1120 620, 1600 340"
          stroke="url(#roadGrad)"
          strokeWidth="34"
        />
        <path
          d="M 240 -60 C 160 220, 380 380, 260 600 S 440 920, 320 1000"
          stroke="url(#roadGrad)"
          strokeWidth="28"
        />
        <path
          d="M 1180 -60 C 1260 240, 1040 420, 1180 640 S 1280 920, 1160 1000"
          stroke="url(#roadGrad)"
          strokeWidth="28"
        />
        <path
          d="M -80 760 C 260 700, 520 820, 860 680 S 1280 820, 1600 700"
          stroke="url(#roadGrad)"
          strokeWidth="22"
        />
      </g>

      {/* Тонкие «улицы» второго уровня */}
      <g fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="1">
        <path d="M -50 180 C 300 260, 700 120, 1500 320" />
        <path d="M 120 -50 C 220 300, 80 600, 420 950" />
        <path d="M 980 -50 C 1080 280, 1240 520, 1340 950" />
        <path d="M -50 720 C 340 620, 780 840, 1500 620" />
        <path d="M 720 -50 C 680 300, 780 600, 720 950" />
      </g>

      {/* Маршруты между маркерами — сильно изогнутые cubic Bezier с
          двойными изгибами. Замкнуты в кольцо: Дом → Школа → Секция →
          Бабушка → Дом. Разные длительности анимации, чтобы пунктиры не
          ходили в унисон. */}
      <g fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="1.4" strokeLinecap="round">
        <path d="M 220 185 C 480 40, 820 360, 1245 225" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="2.2s"
            repeatCount="indefinite"
          />
        </path>
        <path d="M 1245 225 C 1440 380, 1100 540, 1260 695" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="2.7s"
            repeatCount="indefinite"
          />
        </path>
        <path d="M 1260 695 C 900 880, 540 540, 195 720" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="3.1s"
            repeatCount="indefinite"
          />
        </path>
        <path d="M 195 720 C 30 520, 380 380, 220 185" strokeDasharray="5 10">
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-30"
            dur="2.8s"
            repeatCount="indefinite"
          />
        </path>
      </g>

      {/* GPS-маркеры с подписями */}
      {MARKERS.map((m) => (
        <g key={m.label} transform={`translate(${m.x} ${m.y})`}>
          <circle r="4" fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5">
            <animate
              attributeName="r"
              from="4"
              to="44"
              dur="2.6s"
              begin={`${m.delay}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.9"
              to="0"
              dur="2.6s"
              begin={`${m.delay}s`}
              repeatCount="indefinite"
            />
          </circle>
          <circle r="4" fill="none" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5">
            <animate
              attributeName="r"
              from="4"
              to="44"
              dur="2.6s"
              begin={`${m.delay + 1.3}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.9"
              to="0"
              dur="2.6s"
              begin={`${m.delay + 1.3}s`}
              repeatCount="indefinite"
            />
          </circle>
          <path
            d="M 0 -17 C -9 -17 -12 -10 -12 -5 C -12 5 0 15 0 15 C 0 15 12 5 12 -5 C 12 -10 9 -17 0 -17 Z"
            fill="rgb(56,189,248)"
            filter="url(#pinGlow)"
          />
          <circle cy="-6" r="3.2" fill="rgb(15,23,42)" />

          {/* Подпись под пином: тёмная «плашка» + название места */}
          <rect
            x={-m.labelWidth / 2}
            y="24"
            width={m.labelWidth}
            height="22"
            rx="6"
            fill="rgba(10,15,25,0.88)"
            stroke="rgba(71,85,105,0.7)"
            strokeWidth="0.8"
          />
          <text
            x="0"
            y="35"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="13"
            fontWeight="500"
            fill="rgb(226,232,240)"
            style={{
              fontFamily: "var(--font-sans), system-ui, -apple-system, 'Segoe UI', sans-serif",
            }}
          >
            {m.label}
          </text>
        </g>
      ))}
    </svg>
  );
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

  const inputClass =
    'w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20';
  const primaryBtnClass =
    'w-full rounded-md bg-sky-500 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(56,189,248,0.4),0_8px_24px_-8px_rgba(56,189,248,0.6)] transition hover:bg-sky-400 hover:shadow-[0_0_0_1px_rgba(125,211,252,0.5),0_12px_32px_-8px_rgba(56,189,248,0.8)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-sky-500';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050a15] text-slate-100">
      <LoginMapBackground />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <div
          className="w-full max-w-sm rounded-xl border border-slate-700/60 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl"
          style={{ animation: 'fade-up 0.6s ease-out both' }}
        >
          <h1 className="mb-1 text-center text-2xl font-semibold text-white">Вход в GMD</h1>
          <p className="mb-6 text-center text-xs text-slate-400">
            Родительский контроль и геолокация
          </p>

          {/* Mode switcher */}
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
            <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
