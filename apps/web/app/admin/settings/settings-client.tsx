'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { adminApi, type AppSettingRow } from '@/lib/api/admin';
import { useAuthStore } from '@/lib/auth-store';

interface Section {
  id: string;
  title: string;
  description?: string;
  keys: string[];
}

const SECTIONS: Section[] = [
  {
    id: 'trip',
    title: 'Настройка сохранения маршрутов',
    description: 'Параметры сегментации поездок ребёнка на участки «остановка / движение».',
    keys: ['trip.idle_minutes', 'trip.idle_radius_m'],
  },
  {
    id: 'smtp',
    title: 'Настройка SMTP',
    description:
      'Почтовый сервер для отправки уведомлений — регистрация, подтверждение email, сброс пароля. Изменения применяются сразу без рестарта backend.',
    keys: ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from'],
  },
];

const KNOWN_KEYS = new Set(SECTIONS.flatMap((s) => s.keys));

const KEY_LABELS: Record<string, string> = {
  'trip.idle_minutes': 'Минуты простоя',
  'trip.idle_radius_m': 'Радиус «остановки», м',
  'smtp.host': 'Хост',
  'smtp.port': 'Порт',
  'smtp.user': 'Пользователь',
  'smtp.pass': 'Пароль',
  'smtp.from': 'От кого (From)',
};

export function SettingsClient(): ReactElement {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.listSettings,
  });

  const bySection = useMemo(() => {
    const map = new Map<string, AppSettingRow>();
    q.data?.settings.forEach((s) => map.set(s.key, s));
    const known = SECTIONS.map((sec) => ({
      section: sec,
      rows: sec.keys.map((k) => map.get(k)).filter((r): r is AppSettingRow => Boolean(r)),
    }));
    const unknownRows = (q.data?.settings ?? []).filter((s) => !KNOWN_KEYS.has(s.key));
    return { known, unknownRows };
  }, [q.data]);

  if (q.isPending) {
    return <p className="text-sm text-zinc-500">Загрузка…</p>;
  }
  if (q.error || !q.data) {
    return <p className="text-sm text-red-600">Не удалось загрузить настройки.</p>;
  }

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
  };

  return (
    <div className="space-y-8">
      {bySection.known.map(({ section, rows }) =>
        rows.length === 0 ? null : (
          <SectionCard key={section.id} section={section}>
            <div className="space-y-4">
              {rows.map((row) => (
                <SettingRow key={row.key} row={row} onSaved={invalidate} />
              ))}
              {section.id === 'smtp' && <SmtpTestBlock />}
            </div>
          </SectionCard>
        ),
      )}

      {bySection.unknownRows.length > 0 && (
        <SectionCard
          section={{
            id: 'other',
            title: 'Прочее',
            description: 'Настройки, не входящие в основные секции.',
            keys: [],
          }}
        >
          <div className="space-y-4">
            {bySection.unknownRows.map((row) => (
              <SettingRow key={row.key} row={row} onSaved={invalidate} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function SectionCard({
  section,
  children,
}: {
  section: Section;
  children: React.ReactNode;
}): ReactElement {
  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-zinc-900">{section.title}</h2>
        {section.description && <p className="mt-1 text-sm text-zinc-600">{section.description}</p>}
      </header>
      {children}
    </section>
  );
}

function SettingRow({ row, onSaved }: { row: AppSettingRow; onSaved: () => void }): ReactElement {
  const [value, setValue] = useState(row.value ?? '');

  // Если на сервере значение поменялось — подтягиваем. Для секретов значение
  // всегда null, поле остаётся пустым.
  useEffect(() => setValue(row.value ?? ''), [row.value]);

  const m = useMutation({
    mutationFn: (v: string) => adminApi.updateSetting(row.key, v),
    onSuccess: () => {
      toast.success('Сохранено');
      setValue('');
      onSaved();
    },
    onError: (e: unknown) => {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : 'не удалось сохранить'}`);
    },
  });

  const isSecret = row.isSecret;
  // Для не-секрета dirty = value отличается от серверного; для секрета — просто
  // непустая строка (пустое = «не менять»).
  const dirty = isSecret ? value.length > 0 : value !== (row.value ?? '');
  const label = KEY_LABELS[row.key] ?? row.key;
  const inputType = isSecret ? 'password' : 'text';
  const placeholder = isSecret
    ? row.hasValue
      ? '•••••••• (оставьте пустым, чтобы не менять)'
      : 'Введите пароль'
    : undefined;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-900">{label}</div>
          <code className="text-xs text-zinc-400">{row.key}</code>
        </div>
        <span className="shrink-0 text-xs text-zinc-500">
          {new Date(row.updatedAt).toLocaleString('ru')}
          {row.updatedBy ? ` · ${row.updatedBy}` : ''}
        </span>
      </div>
      {row.description && <p className="mb-3 text-sm text-zinc-600">{row.description}</p>}
      <div className="flex items-center gap-2">
        <input
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete={isSecret ? 'new-password' : undefined}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={!dirty || m.isPending}
          onClick={() => m.mutate(value)}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {m.isPending ? '…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

function SmtpTestBlock(): ReactElement {
  const currentEmail = useAuthStore((s) => s.user?.email ?? '');
  const [to, setTo] = useState(currentEmail);

  useEffect(() => {
    if (!to && currentEmail) setTo(currentEmail);
  }, [currentEmail, to]);

  const m = useMutation({
    mutationFn: (addr: string) => adminApi.smtpTest(addr),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Письмо отправлено${res.messageId ? ` (id: ${res.messageId})` : ''}`);
      } else {
        toast.error(`Не удалось отправить: ${res.error ?? 'неизвестная ошибка'}`);
      }
    },
    onError: (e: unknown) => {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : 'не удалось отправить'}`);
    },
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-4">
      <div className="mb-2 text-sm font-semibold text-zinc-900">Проверка SMTP</div>
      <p className="mb-3 text-sm text-zinc-600">
        Письмо отправляется через текущие настройки SMTP (только что сохранённые — тоже). Если
        письмо не пришло за минуту — проверьте host, порт и пароль.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="кому отправить тест"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={!emailValid || m.isPending}
          onClick={() => m.mutate(to.trim())}
          className="rounded-md border border-zinc-300 bg-white px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {m.isPending ? 'Отправляем…' : 'Отправить тест'}
        </button>
      </div>
    </div>
  );
}
