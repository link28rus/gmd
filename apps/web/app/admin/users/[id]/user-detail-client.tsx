'use client';

import Link from 'next/link';
import { useAdminUser } from '@/lib/hooks/use-admin';
import { AdminClient } from '../../admin-client';

interface Props {
  id: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-zinc-100 py-2 last:border-0">
      <dt className="w-48 shrink-0 text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-900">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <dl>{children}</dl>
    </div>
  );
}

function UserDetailInner({ id }: Props) {
  const { data, isLoading, error } = useAdminUser(id);

  if (isLoading) return <p className="text-sm text-zinc-400">Загружаем…</p>;
  if (error || !data)
    return <p className="text-sm text-red-600">Пользователь не найден или ошибка сервера.</p>;

  const { user, memberships, children, refreshTokensActive, otpCodesActiveLast24h } = data;

  return (
    <div>
      <div className="mb-4">
        <Link href="/admin/users" className="text-sm text-blue-600 hover:underline">
          &larr; Назад к списку
        </Link>
      </div>

      <Section title="Основное">
        <Row label="ID" value={<code className="text-xs">{user.id}</code>} />
        <Row label="Email" value={user.email} />
        <Row label="Имя" value={user.name ?? '—'} />
        <Row label="Локаль" value={user.locale} />
        <Row label="Версия политики" value={user.acceptedPrivacyPolicyVersion ?? '—'} />
        <Row label="Создан" value={new Date(user.createdAt).toLocaleString('ru')} />
        <Row label="Обновлён" value={new Date(user.updatedAt).toLocaleString('ru')} />
        <Row
          label="Удалён"
          value={
            user.deletedAt ? (
              <span className="text-red-600">{new Date(user.deletedAt).toLocaleString('ru')}</span>
            ) : (
              '—'
            )
          }
        />
      </Section>

      <Section title="Безопасность">
        <Row label="Активных refresh-токенов" value={String(refreshTokensActive)} />
        <Row label="OTP-кодов за 24ч" value={String(otpCodesActiveLast24h)} />
      </Section>

      {memberships.length > 0 && (
        <Section title="Членства в семьях">
          {memberships.map((m) => (
            <Row
              key={m.familyId}
              label={m.familyName}
              value={<span className="rounded bg-zinc-100 px-2 py-0.5 text-xs">{m.role}</span>}
            />
          ))}
        </Section>
      )}

      {children.length > 0 && (
        <Section title="Дети">
          {children.map((c) => (
            <Row
              key={c.id}
              label={c.name}
              value={
                <span className="text-sm text-zinc-600">
                  {c.dateOfBirth ? new Date(c.dateOfBirth).toLocaleDateString('ru') : '—'} •{' '}
                  {c.hasDevice ? 'устройство привязано' : 'устройства нет'}
                  {c.deviceLastSeenAt
                    ? ` • последний онлайн ${new Date(c.deviceLastSeenAt).toLocaleString('ru')}`
                    : ''}
                </span>
              }
            />
          ))}
        </Section>
      )}
    </div>
  );
}

export function UserDetailClient({ id }: Props) {
  return (
    <AdminClient>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Пользователь</h1>
        <UserDetailInner id={id} />
      </div>
    </AdminClient>
  );
}
