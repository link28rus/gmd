// apps/web/app/cabinet/profile/profile-client.tsx
// v0.75.0: профиль — ФИО взрослого. Его видит семья: список участников,
// карточки телефонов в «Найти телефон», метка на общей карте.
'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { refreshAccessToken } from '@/lib/auth/refresh-singleflight';
import { apiFetch, ApiError } from '@/lib/api/client';
import {
  initialNameParts,
  NAME_PART_MAX,
  namePayload,
  validateNameParts,
  type MeNameFields,
  type NameParts,
} from '@/lib/profile/profile-name';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ME_KEY = ['me', 'profile'] as const;

interface MeResponse {
  user: MeNameFields & { id: string; email: string };
}

export default function ProfileClient(): ReactElement {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAll = useAuthStore((s) => s.setAll);
  const [bootstrapping, setBootstrapping] = useState(accessToken === null);

  // Тот же bootstrap, что у остальных страниц кабинета.
  useEffect(() => {
    if (accessToken !== null) {
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

  const meQ = useQuery({
    queryKey: ME_KEY,
    queryFn: () => apiFetch<MeResponse>('/api/me'),
    enabled: !bootstrapping,
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-4 text-sm">
        <Link href="/cabinet" className="text-muted-foreground hover:text-foreground">
          ← В кабинет
        </Link>
      </div>
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-foreground">Профиль</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          ФИО видят взрослые вашей семьи — в списке семьи, на карте и в «Найти телефон».
        </p>
        {bootstrapping || meQ.isPending ? (
          <p className="text-sm text-muted-foreground">Загружаем…</p>
        ) : meQ.isError || !meQ.data ? (
          <p className="text-sm text-muted-foreground">
            Не удалось загрузить профиль.{' '}
            <button
              type="button"
              onClick={() => meQ.refetch()}
              className="text-foreground underline underline-offset-4"
            >
              Повторить
            </button>
          </p>
        ) : (
          <ProfileForm email={meQ.data.user.email} initial={initialNameParts(meQ.data.user)} />
        )}
      </div>
    </div>
  );
}

function ProfileForm({ email, initial }: { email: string; initial: NameParts }): ReactElement {
  const qc = useQueryClient();
  const patchUser = useAuthStore((s) => s.patchUser);
  const [parts, setParts] = useState<NameParts>(initial);

  const saveM = useMutation({
    mutationFn: () =>
      apiFetch<{ user: MeNameFields }>('/api/me', {
        method: 'PATCH',
        body: JSON.stringify(namePayload(parts)),
      }),
    onSuccess: (res) => {
      // Шапка кабинета берёт имя из store — обновляем сразу.
      patchUser({ name: res.user.name });
      void qc.invalidateQueries({ queryKey: ME_KEY });
      toast.success('Профиль сохранён');
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.status === 400
          ? 'Проверьте ФИО — недопустимые символы или слишком длинно'
          : 'Не удалось сохранить профиль',
      ),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const err = validateNameParts(parts);
    if (err) {
      toast.error(err);
      return;
    }
    saveM.mutate();
  };

  const field = (key: keyof NameParts, label: string, required: boolean, autoComplete: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`profile-${key}`}>
        {label}
        {!required && <span className="font-normal text-muted-foreground"> — необязательно</span>}
      </Label>
      <Input
        id={`profile-${key}`}
        value={parts[key]}
        maxLength={NAME_PART_MAX}
        autoComplete={autoComplete}
        required={required}
        disabled={saveM.isPending}
        onChange={(e) => setParts((p) => ({ ...p, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {field('lastName', 'Фамилия', true, 'family-name')}
      {field('firstName', 'Имя', true, 'given-name')}
      {field('middleName', 'Отчество', false, 'additional-name')}
      <div className="space-y-1.5">
        <Label htmlFor="profile-email">Email</Label>
        <Input id="profile-email" value={email} readOnly disabled />
      </div>
      <Button type="submit" className="w-full" disabled={saveM.isPending}>
        {saveM.isPending ? 'Сохраняем…' : 'Сохранить'}
      </Button>
    </form>
  );
}
