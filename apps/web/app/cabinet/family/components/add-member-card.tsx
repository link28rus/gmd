'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { copyText } from '@/lib/clipboard';
import { createMemberErrorMessage, type FamilyMember } from '@/lib/api/family';
import {
  MEMBER_NAME_MAX,
  MEMBER_PASSWORD_MAX,
  MEMBER_PASSWORD_MIN,
  generateMemberPassword,
  memberCredentialsText,
  validateNewMember,
  type NewMemberErrors,
  type NewMemberForm,
} from '@/lib/family/member-account';
import { useCreateMember } from '@/lib/hooks/use-family';

const EMPTY: NewMemberForm = {
  lastName: '',
  firstName: '',
  middleName: '',
  email: '',
  password: '',
};

// Пароль заводится для ДРУГОГО человека — менеджерам паролей его не предлагаем.
const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
} as const;

interface Created {
  member: FamilyMember;
  password: string;
}

type Mode = 'idle' | 'form' | 'done';

export function AddMemberCard(): ReactElement {
  const create = useCreateMember();
  const [mode, setMode] = useState<Mode>('idle');
  const [form, setForm] = useState<NewMemberForm>(EMPTY);
  const [errors, setErrors] = useState<NewMemberErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  function update<K extends keyof NewMemberForm>(key: K, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
    setSubmitError(null);
  }

  function reset(next: Mode): void {
    setForm(EMPTY);
    setErrors({});
    setSubmitError(null);
    setShowPassword(false);
    setCreated(null);
    setMode(next);
  }

  function onGenerate(): void {
    update('password', generateMemberPassword());
    setShowPassword(true);
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const found = validateNewMember(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitError(null);
    try {
      const member = await create.mutateAsync({
        email: form.email,
        lastName: form.lastName,
        firstName: form.firstName,
        middleName: form.middleName,
        password: form.password,
      });
      setCreated({ member, password: form.password });
      setForm(EMPTY);
      setShowPassword(false);
      setMode('done');
    } catch (err) {
      setSubmitError(createMemberErrorMessage(err));
    }
  }

  async function onCopy(): Promise<void> {
    if (!created) return;
    const text = memberCredentialsText(
      window.location.origin,
      created.member.email,
      created.password,
    );
    if (await copyText(text)) toast.success('Данные для входа скопированы');
    else toast.error('Не удалось скопировать — выделите и скопируйте вручную');
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Создать аккаунт</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Вы сами задаёте email и пароль и передаёте их человеку — регистрироваться и подтверждать
        почту ему не нужно. Удобно, если человеку сложно зарегистрироваться самому. Пароль он сможет
        сменить в кабинете.
      </p>

      {mode === 'idle' && (
        <Button variant="outline" onClick={() => reset('form')}>
          <KeyRound className="mr-1.5 h-4 w-4" />
          Добавить участника
        </Button>
      )}

      {mode === 'form' && (
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          {/* ФИО как при регистрации: фамилия и имя обязательны, отчество — по желанию. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="member-last-name" label="Фамилия" error={errors.lastName}>
              <Input
                id="member-last-name"
                value={form.lastName}
                maxLength={MEMBER_NAME_MAX}
                onChange={(e) => update('lastName', e.target.value)}
                aria-invalid={errors.lastName ? true : undefined}
                aria-describedby={errors.lastName ? 'member-last-name-error' : undefined}
                {...NO_AUTOFILL}
                autoFocus
              />
            </Field>
            <Field id="member-first-name" label="Имя" error={errors.firstName}>
              <Input
                id="member-first-name"
                value={form.firstName}
                maxLength={MEMBER_NAME_MAX}
                onChange={(e) => update('firstName', e.target.value)}
                aria-invalid={errors.firstName ? true : undefined}
                aria-describedby={errors.firstName ? 'member-first-name-error' : undefined}
                {...NO_AUTOFILL}
              />
            </Field>
            <Field
              id="member-middle-name"
              label="Отчество"
              hint="необязательно"
              error={errors.middleName}
            >
              <Input
                id="member-middle-name"
                value={form.middleName}
                maxLength={MEMBER_NAME_MAX}
                onChange={(e) => update('middleName', e.target.value)}
                aria-invalid={errors.middleName ? true : undefined}
                aria-describedby={errors.middleName ? 'member-middle-name-error' : undefined}
                {...NO_AUTOFILL}
              />
            </Field>
          </div>

          <Field id="member-email" label="Email" error={errors.email}>
            <Input
              id="member-email"
              type="email"
              inputMode="email"
              value={form.email}
              maxLength={320}
              onChange={(e) => update('email', e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'member-email-error' : undefined}
              {...NO_AUTOFILL}
            />
          </Field>

          <Field
            id="member-password"
            label="Пароль"
            hint={`не короче ${MEMBER_PASSWORD_MIN} символов`}
            error={errors.password}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Input
                  id="member-password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  maxLength={MEMBER_PASSWORD_MAX}
                  onChange={(e) => update('password', e.target.value)}
                  className="pr-10 font-mono"
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={errors.password ? 'member-password-error' : undefined}
                  {...NO_AUTOFILL}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button type="button" variant="outline" onClick={onGenerate}>
                <Wand2 className="mr-1.5 h-4 w-4" />
                Сгенерировать
              </Button>
            </div>
          </Field>

          {submitError && (
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Создаём…' : 'Создать аккаунт'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={create.isPending}
              onClick={() => reset('idle')}
            >
              Отмена
            </Button>
          </div>
        </form>
      )}

      {mode === 'done' && created && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4">
          <p className="mb-3 flex items-center gap-1.5 font-semibold text-foreground">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
            Аккаунт создан — {created.member.displayName || created.member.email} теперь в семье
          </p>
          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="select-all break-all font-mono text-foreground">
              {created.member.email}
            </dd>
            <dt className="text-muted-foreground">Пароль</dt>
            <dd className="select-all break-all font-mono text-foreground">{created.password}</dd>
          </dl>
          <p
            role="note"
            className="mb-3 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Пароль больше не будет показан — сохраните или передайте его сейчас.
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            Человек войдёт на странице входа «По паролю» и при первом входе примет политику
            конфиденциальности.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onCopy()}>
              <Copy className="mr-1.5 h-4 w-4" />
              Копировать данные для входа
            </Button>
            <Button variant="outline" onClick={() => reset('form')}>
              Добавить ещё
            </Button>
            <Button variant="ghost" onClick={() => reset('idle')}>
              Готово
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {hint && <span className="ml-1 font-normal text-muted-foreground">({hint})</span>}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
