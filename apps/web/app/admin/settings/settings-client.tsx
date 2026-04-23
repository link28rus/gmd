'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Info } from 'lucide-react';
import { adminApi, type AppSettingRow } from '@/lib/api/admin';
import { useAuthStore } from '@/lib/auth-store';

interface Section {
  id: string;
  title: string;
  description?: string;
  keys: string[];
  /** Цвет dot-индикатора слева от заголовка секции. */
  accent: 'sky' | 'amber';
}

const SECTIONS: Section[] = [
  {
    id: 'gps-filter',
    title: 'Фильтрация GPS-шума',
    description:
      'Защита от «звёздного» дрожания GPS в помещениях. Сохраняется только то, что похоже на реальное движение.',
    keys: ['location.accuracy_floor_m', 'location.jitter_window_ms', 'location.jitter_min_dist_m'],
    accent: 'sky',
  },
  {
    id: 'routes',
    title: 'Сохранение маршрутов',
    description: 'Сегментация поездок ребёнка на участки «остановка / движение».',
    keys: ['trip.idle_minutes', 'trip.idle_radius_m'],
    accent: 'sky',
  },
  {
    id: 'smtp',
    title: 'Почтовый сервер',
    description: 'Отправка писем: подтверждение email, сброс пароля, уведомления.',
    keys: ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from'],
    accent: 'amber',
  },
];

const KNOWN_KEYS = new Set(SECTIONS.flatMap((s) => s.keys));

const KEY_META: Record<
  string,
  {
    label: string;
    unit?: string;
    inputMode?: 'numeric' | 'email' | 'url' | 'text';
    width?: string;
  }
> = {
  'trip.idle_minutes': {
    label: 'Минут без движения',
    unit: 'мин',
    inputMode: 'numeric',
    width: 'w-32',
  },
  'trip.idle_radius_m': {
    label: 'Радиус «остановки»',
    unit: 'м',
    inputMode: 'numeric',
    width: 'w-32',
  },
  'location.accuracy_floor_m': {
    label: 'Порог точности (accuracy)',
    unit: 'м',
    inputMode: 'numeric',
    width: 'w-32',
  },
  'location.jitter_window_ms': {
    label: 'Окно dedup-а',
    unit: 'мс',
    inputMode: 'numeric',
    width: 'w-32',
  },
  'location.jitter_min_dist_m': {
    label: 'Мин. сдвиг',
    unit: 'м',
    inputMode: 'numeric',
    width: 'w-32',
  },
  'smtp.host': { label: 'Хост', inputMode: 'url', width: 'w-56' },
  'smtp.port': { label: 'Порт', unit: '/tcp', inputMode: 'numeric', width: 'w-24' },
  'smtp.user': { label: 'Пользователь', inputMode: 'email', width: 'w-56' },
  'smtp.pass': { label: 'Пароль', width: 'w-56' },
  'smtp.from': { label: 'Отправитель (From)', width: 'w-56' },
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
    return <LoadingState />;
  }
  if (q.error || !q.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Не удалось загрузить настройки. Попробуйте обновить страницу.
      </div>
    );
  }

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
  };

  return (
    <div className="space-y-10">
      {bySection.known.map(({ section, rows }) =>
        rows.length === 0 ? null : (
          <SectionBlock key={section.id} section={section}>
            <ListCard>
              {rows.map((row) => (
                <SettingRow key={row.key} row={row} onSaved={invalidate} />
              ))}
              {section.id === 'smtp' && <SmtpTestRow />}
            </ListCard>
          </SectionBlock>
        ),
      )}

      {bySection.unknownRows.length > 0 && (
        <SectionBlock
          section={{
            id: 'misc',
            title: 'Прочие ключи',
            description: 'Настройки, не закреплённые за основными разделами.',
            keys: [],
            accent: 'sky',
          }}
        >
          <ListCard>
            {bySection.unknownRows.map((row) => (
              <SettingRow key={row.key} row={row} onSaved={invalidate} />
            ))}
          </ListCard>
        </SectionBlock>
      )}
    </div>
  );
}

function LoadingState(): ReactElement {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-card"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

function SectionBlock({
  section,
  children,
}: {
  section: Section;
  children: ReactNode;
}): ReactElement {
  const dot = section.accent === 'amber' ? 'bg-amber-500' : 'bg-sky-500';
  return (
    <section id={section.id}>
      <header className="mb-3 flex items-baseline gap-2 px-1">
        <span className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
          {section.title}
        </h2>
        {section.description && (
          <span className="ml-auto truncate text-[12px] text-muted-foreground">
            {section.description}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function ListCard({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-zinc-100">
      {children}
    </div>
  );
}

function SettingRow({ row, onSaved }: { row: AppSettingRow; onSaved: () => void }): ReactElement {
  const [value, setValue] = useState(row.value ?? '');
  const [justSaved, setJustSaved] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => setValue(row.value ?? ''), [row.value]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const m = useMutation({
    mutationFn: (v: string) => adminApi.updateSetting(row.key, v),
    onSuccess: () => {
      toast.success('Сохранено');
      setValue('');
      setJustSaved(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setJustSaved(false), 1600);
      onSaved();
    },
    onError: (e: unknown) => {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : 'не удалось сохранить'}`);
    },
  });

  const meta = KEY_META[row.key];
  const isSecret = row.isSecret;
  const dirty = isSecret ? value.length > 0 : value !== (row.value ?? '');
  const label = meta?.label ?? row.key;
  const inputType = isSecret ? 'password' : 'text';
  const placeholder = isSecret ? (row.hasValue ? '••••••••' : 'Введите пароль') : undefined;
  const inputWidth = meta?.width ?? 'w-48';

  const hasDescription = Boolean(row.description && row.description.trim().length > 0);

  return (
    <div className="transition-colors hover:bg-muted/80">
      <div className="group flex items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{label}</span>
            {isSecret && (
              <span
                className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500"
                title="Зашифровано (AES-256-GCM)"
                aria-label="Зашифровано"
              />
            )}
            {hasDescription && (
              <button
                type="button"
                onClick={() => setDescOpen((v) => !v)}
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors ${
                  descOpen
                    ? 'bg-sky-100 text-sky-700'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                aria-label={descOpen ? 'Скрыть описание' : 'Показать описание'}
                aria-expanded={descOpen}
              >
                <Info className="h-3 w-3" strokeWidth={2.5} />
              </button>
            )}
          </div>
          <code className="block truncate font-mono text-[11px] text-muted-foreground">
            {row.key}
          </code>
        </div>

        <div className={`relative shrink-0 ${inputWidth}`}>
          <input
            type={inputType}
            value={value}
            placeholder={placeholder}
            inputMode={meta?.inputMode as React.InputHTMLAttributes<HTMLInputElement>['inputMode']}
            autoComplete={isSecret ? 'new-password' : undefined}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-2.5 py-1 pr-7 font-mono text-[13px] text-foreground transition-colors placeholder:font-sans placeholder:text-muted-foreground focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
          />
          {meta?.unit && !isSecret && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              {meta.unit}
            </span>
          )}
        </div>

        {/* Save отрисовывается всегда, но видим только при dirty — освободит
            место в layout, не даст строкам скакать. Иконка-галка появляется
            на 1.5с после успешного сохранения. */}
        <button
          type="button"
          disabled={!dirty || m.isPending}
          onClick={() => m.mutate(value)}
          aria-label="Сохранить"
          className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
            dirty
              ? 'bg-foreground text-white hover:bg-zinc-800'
              : justSaved
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-transparent text-transparent'
          } disabled:cursor-not-allowed`}
        >
          <span className="inline-flex items-center gap-1">
            {m.isPending ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-white" />
            ) : justSaved ? (
              <Check className="h-3 w-3" strokeWidth={3} />
            ) : null}
            {m.isPending ? '…' : justSaved ? 'OK' : 'Сохранить'}
          </span>
        </button>
      </div>

      {/* Раскрываемое описание. Показывается только когда админ нажал ⓘ.
          Поддерживает длинный текст с примерами — формат «что делает / когда менять». */}
      {hasDescription && descOpen && (
        <div className="border-t border-border bg-muted/40 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {row.description}
        </div>
      )}
    </div>
  );
}

function SmtpTestRow(): ReactElement {
  const currentEmail = useAuthStore((s) => s.user?.email ?? '');
  const [to, setTo] = useState(currentEmail);
  const [lastResult, setLastResult] = useState<
    { kind: 'ok'; messageId?: string } | { kind: 'err'; error: string } | null
  >(null);

  useEffect(() => {
    if (!to && currentEmail) setTo(currentEmail);
  }, [currentEmail, to]);

  const m = useMutation({
    mutationFn: (addr: string) => adminApi.smtpTest(addr),
    onSuccess: (res) => {
      if (res.ok) {
        setLastResult({ kind: 'ok', messageId: res.messageId });
        toast.success(`Письмо отправлено${res.messageId ? ` · ${res.messageId}` : ''}`);
      } else {
        setLastResult({ kind: 'err', error: res.error ?? 'unknown' });
        toast.error(`Не удалось: ${res.error ?? 'неизвестная ошибка'}`);
      }
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'network error';
      setLastResult({ kind: 'err', error: msg });
      toast.error(`Ошибка: ${msg}`);
    },
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());

  return (
    <div className="flex items-center gap-3 bg-muted/70 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">Проверка</span>
          {lastResult?.kind === 'ok' && (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          )}
          {lastResult?.kind === 'err' && (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
          )}
        </div>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {lastResult
            ? lastResult.kind === 'ok'
              ? `✓ delivered${lastResult.messageId ? ` · ${lastResult.messageId}` : ''}`
              : `✗ ${lastResult.error}`
            : 'Отправит тестовое письмо через текущие SMTP-настройки'}
        </span>
      </div>
      <input
        type="email"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="recipient@example.com"
        className="w-56 shrink-0 rounded-md border border-border bg-card px-2.5 py-1 font-mono text-[13px] text-foreground focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200"
      />
      <button
        type="button"
        disabled={!emailValid || m.isPending}
        onClick={() => m.mutate(to.trim())}
        className="shrink-0 rounded-md bg-foreground px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {m.isPending ? 'Шлём…' : 'Отправить'}
      </button>
    </div>
  );
}
