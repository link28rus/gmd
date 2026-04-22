'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Lock, Play, Send, Terminal } from 'lucide-react';
import { adminApi, type AppSettingRow } from '@/lib/api/admin';
import { useAuthStore } from '@/lib/auth-store';

interface Section {
  id: string;
  index: string;
  title: string;
  kicker: string;
  description?: string;
  keys: string[];
}

const SECTIONS: Section[] = [
  {
    id: 'routes',
    index: '01',
    kicker: 'Routes',
    title: 'Сохранение маршрутов',
    description:
      'Параметры сегментации поездок ребёнка на участки «остановка / движение». Применяются к трекам во всех семьях.',
    keys: ['trip.idle_minutes', 'trip.idle_radius_m'],
  },
  {
    id: 'smtp',
    index: '02',
    kicker: 'Mail · SMTP',
    title: 'Почтовый сервер',
    description:
      'Отправка писем — подтверждение email, сброс пароля, системные уведомления. Изменения применяются сразу без рестарта backend.',
    keys: ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.from'],
  },
];

const KNOWN_KEYS = new Set(SECTIONS.flatMap((s) => s.keys));

const KEY_META: Record<
  string,
  { label: string; unit?: string; inputMode?: 'numeric' | 'email' | 'url' | 'text' }
> = {
  'trip.idle_minutes': { label: 'Минут без движения', unit: 'мин', inputMode: 'numeric' },
  'trip.idle_radius_m': { label: 'Радиус «остановки»', unit: 'м', inputMode: 'numeric' },
  'smtp.host': { label: 'Хост', inputMode: 'url' },
  'smtp.port': { label: 'Порт', unit: '/tcp', inputMode: 'numeric' },
  'smtp.user': { label: 'Пользователь', inputMode: 'email' },
  'smtp.pass': { label: 'Пароль' },
  'smtp.from': { label: 'Отправитель (From)' },
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
    <div className="grid gap-12 md:grid-cols-[180px_1fr] md:gap-16">
      <TableOfContents
        items={bySection.known
          .filter((b) => b.rows.length > 0)
          .map(({ section }) => ({
            id: section.id,
            index: section.index,
            title: section.title,
          }))}
      />

      <div className="min-w-0 space-y-16">
        {bySection.known.map(({ section, rows }) =>
          rows.length === 0 ? null : (
            <SectionBlock key={section.id} section={section}>
              <div className="divide-y divide-zinc-200 border-y border-zinc-200">
                {rows.map((row) => (
                  <SettingRow key={row.key} row={row} onSaved={invalidate} />
                ))}
              </div>
              {section.id === 'smtp' && <SmtpTestBlock />}
            </SectionBlock>
          ),
        )}

        {bySection.unknownRows.length > 0 && (
          <SectionBlock
            section={{
              id: 'misc',
              index: '··',
              kicker: 'Misc',
              title: 'Прочие ключи',
              description: 'Настройки, не закреплённые за основными разделами.',
              keys: [],
            }}
          >
            <div className="divide-y divide-zinc-200 border-y border-zinc-200">
              {bySection.unknownRows.map((row) => (
                <SettingRow key={row.key} row={row} onSaved={invalidate} />
              ))}
            </div>
          </SectionBlock>
        )}
      </div>
    </div>
  );
}

function LoadingState(): ReactElement {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md border border-zinc-200 bg-white"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

function TableOfContents({
  items,
}: {
  items: { id: string; index: string; title: string }[];
}): ReactElement {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    if (items.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [items]);

  return (
    <aside className="hidden md:block">
      <div className="sticky top-6">
        <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">
          Содержание
        </p>
        <ol className="space-y-1">
          {items.map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`group flex items-baseline gap-3 border-l-2 py-1.5 pl-3 pr-2 text-[13px] transition ${
                    isActive
                      ? 'border-zinc-900 text-zinc-900'
                      : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800'
                  }`}
                >
                  <span
                    className={`font-mono text-[10px] tracking-wider ${
                      isActive ? 'text-sky-600' : 'text-zinc-400'
                    }`}
                  >
                    {item.index}
                  </span>
                  <span className="leading-tight">{item.title}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

function SectionBlock({
  section,
  children,
}: {
  section: Section;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={section.id} className="scroll-mt-6">
      <header className="mb-6 flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tracking-[0.22em] text-zinc-400">
            § {section.index}
          </span>
          <span className="h-px flex-1 bg-zinc-200" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-sky-700">
            {section.kicker}
          </span>
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          {section.title}
        </h2>
        {section.description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-600">
            {section.description}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

function SettingRow({ row, onSaved }: { row: AppSettingRow; onSaved: () => void }): ReactElement {
  const [value, setValue] = useState(row.value ?? '');
  const [justSaved, setJustSaved] = useState(false);
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
  const placeholder = isSecret
    ? row.hasValue
      ? '•••••••• — оставьте пустым, чтобы не менять'
      : 'Введите пароль'
    : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 py-5 md:grid-cols-[280px_1fr] md:gap-8">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-zinc-900">{label}</span>
          {isSecret && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-amber-300/70 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-800">
              <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />
              encrypted
            </span>
          )}
        </div>
        <code className="mt-1 block truncate font-mono text-[11px] text-zinc-500">{row.key}</code>
        {row.description && (
          <p className="mt-2 text-[13px] leading-relaxed text-zinc-600">{row.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          <span>upd · {new Date(row.updatedAt).toLocaleString('ru')}</span>
          {row.updatedBy && <span>by · {row.updatedBy}</span>}
        </div>
      </div>

      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <input
            type={inputType}
            value={value}
            placeholder={placeholder}
            inputMode={meta?.inputMode as React.InputHTMLAttributes<HTMLInputElement>['inputMode']}
            autoComplete={isSecret ? 'new-password' : undefined}
            onChange={(e) => setValue(e.target.value)}
            className="peer w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-14 font-mono text-sm text-zinc-900 transition-colors placeholder:font-sans placeholder:text-zinc-400 focus:border-sky-500 focus:outline-none focus:ring-4 focus:ring-sky-100"
          />
          {meta?.unit && !isSecret && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-[11px] uppercase tracking-wider text-zinc-400"
            >
              {meta.unit}
            </span>
          )}
          {justSaved && (
            <span className="pointer-events-none absolute -bottom-1 left-0 right-0 h-[2px] origin-left animate-[sweep_1.5s_ease-out_forwards] bg-emerald-500" />
          )}
        </div>
        <button
          type="button"
          disabled={!dirty || m.isPending}
          onClick={() => m.mutate(value)}
          className={`shrink-0 rounded-md px-4 py-2 text-sm font-medium transition-all ${
            dirty
              ? 'bg-zinc-900 text-white hover:bg-zinc-800'
              : 'border border-zinc-200 bg-transparent text-zinc-400'
          } disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400`}
        >
          <span className="inline-flex items-center gap-1.5">
            {m.isPending ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/60 border-t-white" />
            ) : justSaved ? (
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            ) : null}
            {m.isPending ? 'Сохранение' : justSaved ? 'Сохранено' : 'Сохранить'}
          </span>
        </button>
      </div>

      <style jsx>{`
        @keyframes sweep {
          0% {
            transform: scaleX(0);
          }
          70% {
            transform: scaleX(1);
          }
          100% {
            transform: scaleX(1);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

type TestLogLine = { kind: 'info' | 'ok' | 'err'; text: string };

function SmtpTestBlock(): ReactElement {
  const currentEmail = useAuthStore((s) => s.user?.email ?? '');
  const [to, setTo] = useState(currentEmail);
  const [log, setLog] = useState<TestLogLine[]>([]);

  useEffect(() => {
    if (!to && currentEmail) setTo(currentEmail);
  }, [currentEmail, to]);

  const m = useMutation({
    mutationFn: async (addr: string) => {
      setLog((prev) => [...prev, { kind: 'info', text: `→ dispatch test probe to ${addr}` }]);
      return adminApi.smtpTest(addr);
    },
    onSuccess: (res) => {
      if (res.ok) {
        setLog((prev) => [
          ...prev,
          {
            kind: 'ok',
            text: `✓ delivered${res.messageId ? ` · message-id: ${res.messageId}` : ''}`,
          },
        ]);
        toast.success('Тестовое письмо отправлено');
      } else {
        setLog((prev) => [
          ...prev,
          { kind: 'err', text: `✗ smtp error: ${res.error ?? 'unknown'}` },
        ]);
        toast.error(`Не удалось отправить: ${res.error ?? 'неизвестная ошибка'}`);
      }
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'network error';
      setLog((prev) => [...prev, { kind: 'err', text: `✗ ${msg}` }]);
      toast.error(`Ошибка: ${msg}`);
    },
  });

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());

  return (
    <div className="mt-8 overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950 text-zinc-100 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.4)]">
      {/* Заголовок terminal-панели — имитирует title bar. */}
      <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
        <Terminal className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.25} />
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-400">
          smtp · диагностика
        </span>
        <span className="ml-auto font-mono text-[10px] tracking-wider text-zinc-500">
          gmd-mailer · v1
        </span>
      </div>

      <div className="px-5 py-6">
        <p className="mb-4 font-mono text-[13px] leading-relaxed text-zinc-400">
          <span className="text-emerald-400">//</span> отправляет тестовое письмо через текущую
          SMTP-конфигурацию. используется сразу после сохранения значений — кэш сбрасывается.
        </p>

        <div className="flex items-stretch gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 font-mono text-sm text-zinc-100 focus-within:border-emerald-500/60 focus-within:ring-4 focus-within:ring-emerald-500/10">
            <span aria-hidden className="text-emerald-400">
              ▸
            </span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              spellCheck={false}
              className="w-full bg-transparent py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={!emailValid || m.isPending}
            onClick={() => m.mutate(to.trim())}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-300 transition hover:border-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
          >
            {m.isPending ? (
              <>
                <Play className="h-3 w-3 animate-pulse" strokeWidth={2.5} />
                sending
              </>
            ) : (
              <>
                <Send className="h-3 w-3" strokeWidth={2.5} />
                probe
              </>
            )}
          </button>
        </div>

        {log.length > 0 && (
          <div className="mt-5 space-y-1 rounded-md border border-zinc-800 bg-black/40 px-4 py-3 font-mono text-[12px] leading-relaxed">
            {log.map((line, i) => (
              <div
                key={i}
                className={
                  line.kind === 'ok'
                    ? 'text-emerald-300'
                    : line.kind === 'err'
                      ? 'text-rose-300'
                      : 'text-zinc-400'
                }
              >
                <span className="mr-2 text-zinc-600">{String(i + 1).padStart(2, '0')}</span>
                {line.text}
              </div>
            ))}
            {m.isPending && (
              <div className="text-zinc-500">
                <span className="mr-2 text-zinc-600">
                  {String(log.length + 1).padStart(2, '0')}
                </span>
                <span className="inline-block h-3 w-2 animate-pulse bg-emerald-400 align-middle" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
