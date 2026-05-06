'use client';

import { useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import Link from 'next/link';
import { AuthMapBackground } from '@/components/auth/auth-map-background';

interface ErrorResponse {
  error?: { code?: string; message?: string; details?: Array<{ path?: string[] }> };
}

const INPUT_CLASS =
  'w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20';

const PRIMARY_BTN =
  'w-full rounded-md bg-sky-500 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(56,189,248,0.4),0_8px_24px_-8px_rgba(56,189,248,0.6)] transition hover:bg-sky-400 hover:shadow-[0_0_0_1px_rgba(125,211,252,0.5),0_12px_32px_-8px_rgba(56,189,248,0.8)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-sky-500';

export default function RegisterClient(): ReactElement {
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function clientValidate(): string | null {
    if (!lastName.trim()) return 'Укажите фамилию';
    if (!firstName.trim()) return 'Укажите имя';
    if (!email.trim()) return 'Укажите email';
    if (password.length < 8) return 'Пароль не короче 8 символов';
    if (password !== passwordConfirm) return 'Пароли не совпадают';
    return null;
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const clientErr = clientValidate();
    if (clientErr) {
      setError(clientErr);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          middleName: middleName.trim() || undefined,
          familyName: familyName.trim() || undefined,
          email: email.trim(),
          password,
          passwordConfirm,
        }),
      });
      if (res.status === 202 || res.status === 200) {
        setSent(true);
        return;
      }
      const json = (await res.json().catch(() => null)) as ErrorResponse | null;
      const code = json?.error?.code;
      if (code === 'email_taken_verified') {
        setError('Этот email уже зарегистрирован. Войдите по паролю или по коду из письма.');
      } else if (res.status === 429) {
        setError('Слишком много попыток, подождите минуту');
      } else {
        setError(json?.error?.message ?? 'Не удалось зарегистрироваться');
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
          className="w-full max-w-md rounded-xl border border-slate-700/60 bg-slate-900/70 p-8 shadow-2xl backdrop-blur-xl"
          style={{ animation: 'fade-up 0.6s ease-out both' }}
        >
          {sent ? (
            <ConfirmationSent email={email} />
          ) : (
            <>
              <h1 className="mb-1 text-center text-2xl font-semibold text-white">
                Регистрация в GMD
              </h1>
              <p className="mb-6 text-center text-xs text-slate-400">
                После регистрации отправим ссылку для подтверждения почты
              </p>

              <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Фамилия" required>
                    <input
                      type="text"
                      required
                      autoFocus
                      autoComplete="family-name"
                      maxLength={80}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className={INPUT_CLASS}
                      placeholder="Иванов"
                    />
                  </Field>
                  <Field label="Имя" required>
                    <input
                      type="text"
                      required
                      autoComplete="given-name"
                      maxLength={80}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={INPUT_CLASS}
                      placeholder="Иван"
                    />
                  </Field>
                </div>
                <Field label="Отчество" hint="необязательно">
                  <input
                    type="text"
                    autoComplete="additional-name"
                    maxLength={80}
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="Иванович"
                  />
                </Field>
                <Field
                  label="Назови семью"
                  hint={`если пусто — подставим «${lastName.trim() || 'Фамилия'}»`}
                >
                  <input
                    type="text"
                    maxLength={80}
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="Семья Ивановых"
                  />
                </Field>
                <Field label="Email" required hint="используется как логин">
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={320}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={INPUT_CLASS}
                    placeholder="you@example.com"
                  />
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Пароль" required>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={INPUT_CLASS}
                      placeholder="••••••••"
                    />
                  </Field>
                  <Field label="Повторите пароль" required>
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
                  </Field>
                </div>

                <button
                  type="submit"
                  disabled={loading || !firstName || !lastName || !email || password.length < 8}
                  className={PRIMARY_BTN}
                >
                  {loading ? 'Регистрируем…' : 'Зарегистрироваться'}
                </button>
              </form>

              <p className="mt-5 text-center text-xs text-slate-500">
                Уже есть аккаунт?{' '}
                <Link href="/login" className="font-medium text-sky-300 hover:text-sky-200">
                  Войти
                </Link>
              </p>

              <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-500">
                Нажимая «Зарегистрироваться», вы принимаете{' '}
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-300">
          {label}
          {required && <span className="ml-0.5 text-sky-400">*</span>}
        </span>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function ConfirmationSent({ email }: { email: string }): ReactElement {
  return (
    <div className="py-4 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/15 text-sky-300 ring-1 ring-sky-400/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      <h2 className="mb-2 text-lg font-semibold text-white">Проверьте почту</h2>
      <p className="text-sm text-slate-300">
        Мы отправили ссылку для подтверждения на <b className="text-white">{email}</b>.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        Перейдите по ссылке из письма — вход произойдёт автоматически. Ссылка действует 24 часа.
      </p>
      <p className="mt-6 text-xs text-slate-500">
        Не пришло письмо?{' '}
        <Link href="/register" className="font-medium text-sky-300 hover:text-sky-200">
          Отправить ещё раз
        </Link>
      </p>
    </div>
  );
}
