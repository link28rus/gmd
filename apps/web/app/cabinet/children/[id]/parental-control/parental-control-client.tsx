'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo, useState, type ReactElement } from 'react';
import { ArrowLeft, Lock, Smartphone } from 'lucide-react';
import {
  rewriteIconUrl,
  type AppCategory,
  type InstalledAppDto,
  type UsageRangeDto,
} from '@/lib/api/app-control';
import { useInstalledApps, useUsage } from '@/lib/hooks/use-app-control';

type RangeTab = 'today' | 'yesterday' | 'week';

const CATEGORY_LABELS: Record<AppCategory, string> = {
  social: 'Соцсети',
  messengers: 'Мессенджеры',
  video: 'Видео',
  games: 'Игры',
  browsers: 'Браузеры',
  education: 'Образование',
  music: 'Музыка',
  navigation: 'Навигация',
  shopping: 'Покупки',
  system: 'Системные',
  other: 'Другое',
};

const CATEGORY_ORDER: AppCategory[] = [
  'social',
  'messengers',
  'video',
  'games',
  'browsers',
  'education',
  'music',
  'navigation',
  'shopping',
  'system',
  'other',
];

function fmtMinutes(seconds: number): string {
  if (seconds < 60) return `${seconds} сек`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

function ymdInTz(date: Date): string {
  // Используем локальное время браузера парента — backend сравнивает с TZ ребёнка
  // только при default-today; явно переданный date просто берётся как DATE.
  // На v0.38 показываем «Сегодня в TZ родителя» (упрощение для MVP).
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function ParentalControlClient({ childId }: { childId: string }): ReactElement {
  const [tab, setTab] = useState<RangeTab>('today');

  // Считаем дату для запроса usage. Today — backend default; yesterday/week —
  // явная дата.
  const queryParams = useMemo(() => {
    const now = new Date();
    if (tab === 'today') return { range: 'day' as const, date: undefined };
    if (tab === 'yesterday') {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { range: 'day' as const, date: ymdInTz(d) };
    }
    return { range: 'week' as const, date: ymdInTz(now) };
  }, [tab]);

  const usageQ = useUsage(childId, queryParams.range, queryParams.date);
  const appsQ = useInstalledApps(childId);

  const range = usageQ.data?.result;
  const apps = appsQ.data?.apps ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/cabinet"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
          title="Назад"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Родительский контроль</h1>
      </div>

      <Tabs tab={tab} onChange={setTab} />

      {usageQ.isPending && (
        <p className="mt-6 text-sm text-muted-foreground">Загрузка статистики…</p>
      )}
      {usageQ.isError && (
        <p className="mt-6 text-sm text-red-600">
          Не удалось загрузить статистику:{' '}
          {usageQ.error instanceof Error ? usageQ.error.message : 'ошибка'}
        </p>
      )}

      {range && <SummaryCard range={range} tab={tab} />}
      {range && <Chart range={range} tab={tab} />}
      {range && <CategoryChips byCategory={range.byCategory} />}

      {/* Заглушка кнопки «Заблокировать» — фича в v0.39. */}
      <DisabledBlockButton />

      <AppsList apps={apps} loading={appsQ.isPending} />
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────

function Tabs({ tab, onChange }: { tab: RangeTab; onChange: (t: RangeTab) => void }): ReactElement {
  const items: Array<{ key: RangeTab; label: string }> = [
    { key: 'yesterday', label: 'Вчера' },
    { key: 'today', label: 'Сегодня' },
    { key: 'week', label: 'Неделя' },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-1">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={
            'rounded-md px-4 py-1.5 text-sm font-medium transition-colors ' +
            (tab === it.key
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground')
          }
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ─── Summary ────────────────────────────────────────────────────────────

function SummaryCard({ range, tab }: { range: UsageRangeDto; tab: RangeTab }): ReactElement {
  const showVs = tab === 'today' && range.vsAverage !== null;
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">Время в приложениях</p>
      <div className="mt-1 flex items-baseline gap-3">
        <p className="text-4xl font-semibold text-foreground">
          {range.totalSeconds === 0 ? '—' : fmtMinutes(range.totalSeconds)}
        </p>
        {showVs && (
          <span
            className={
              'text-sm font-medium ' +
              ((range.vsAverage ?? 0) > 0 ? 'text-orange-600' : 'text-emerald-600')
            }
          >
            {(range.vsAverage ?? 0) > 0 ? '↑' : '↓'} {Math.abs(range.vsAverage ?? 0)}% от обычного
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Chart ──────────────────────────────────────────────────────────────

function Chart({ range, tab }: { range: UsageRangeDto; tab: RangeTab }): ReactElement {
  const max = Math.max(1, ...range.byHour);
  const isWeek = tab === 'week';
  // Подпись для столбца: "HH:00" или "День N"
  const labelFor = (idx: number): string => (isWeek ? `День ${idx + 1}` : `${idx}:00`);
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {isWeek ? 'Минут по дням' : 'Минут по часам'}
      </p>
      <div className="flex h-32 items-end gap-1 border-b border-border/40">
        {range.byHour.map((sec, idx) => {
          const ratio = sec / max;
          const min = Math.round(sec / 60);
          const isEmpty = sec === 0;
          // Активные часы — нормальная высота (минимум 6% для видимости).
          // Пустые часы — одна-пиксельная серая «база», чтобы visually отделять
          // ось от активных столбцов и не создавать ложное впечатление активности.
          const heightPct = isEmpty ? 0 : Math.max(6, ratio * 100);
          return (
            <div
              key={idx}
              className="group relative flex flex-1 items-end"
              title={`${labelFor(idx)} — ${isEmpty ? 'нет активности' : `${min} мин`}`}
            >
              {isEmpty ? (
                <div className="h-px w-full bg-muted-foreground/30" aria-hidden />
              ) : (
                <div
                  className="w-full rounded-t bg-blue-500 transition-colors hover:bg-blue-400"
                  style={{ height: `${heightPct}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
      {!isWeek && (
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <span>6</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      )}
    </div>
  );
}

// ─── Category chips ─────────────────────────────────────────────────────

function CategoryChips({ byCategory }: { byCategory: Record<AppCategory, number> }): ReactElement {
  const items = CATEGORY_ORDER.filter((c) => byCategory[c] > 0).map((c) => ({
    cat: c,
    label: CATEGORY_LABELS[c],
    seconds: byCategory[c],
  }));
  if (items.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-border bg-card/50 p-5 text-sm text-muted-foreground">
        Нет данных о категориях. Если ребёнок только что установил приложение — статистика появится
        в течение 15 минут.
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((it) => (
        <span
          key={it.cat}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm"
        >
          <span className="font-medium text-foreground">{it.label}</span>
          <span className="text-xs text-muted-foreground">{fmtMinutes(it.seconds)}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Block button (v0.39 placeholder) ───────────────────────────────────

function DisabledBlockButton(): ReactElement {
  return (
    <button
      type="button"
      disabled
      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500/40 px-4 py-3 font-medium text-white opacity-60"
      title="Появится в следующем обновлении"
    >
      <Lock className="h-4 w-4" />
      Заблокировать приложения (скоро)
    </button>
  );
}

// ─── Apps list ──────────────────────────────────────────────────────────

function AppsList({ apps, loading }: { apps: InstalledAppDto[]; loading: boolean }): ReactElement {
  // Сортируем: сначала по todaySeconds desc (нюанс — даже на «вчера» tab показываем
  // todaySeconds; для consistency с бэк ответом installed-apps. UI-уточнение придёт
  // вместе с улучшенной фильтрацией в v0.39).
  const sorted = useMemo(
    () =>
      [...apps].sort((a, b) => {
        if (b.todaySeconds !== a.todaySeconds) return b.todaySeconds - a.todaySeconds;
        return a.appLabel.localeCompare(b.appLabel, 'ru');
      }),
    [apps],
  );

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Все приложения{' '}
        {sorted.length > 0 && <span className="text-muted-foreground">({sorted.length})</span>}
      </h2>
      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка списка…</p>
      ) : sorted.length === 0 ? (
        <EmptyAppsHint />
      ) : (
        <ul className="space-y-2">
          {sorted.map((a) => (
            <AppRow key={a.packageName} app={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AppRow({ app }: { app: InstalledAppDto }): ReactElement {
  const proxiedIcon = rewriteIconUrl(app.iconUrl);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {proxiedIcon ? (
          <Image
            src={proxiedIcon}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10"
            unoptimized
          />
        ) : (
          <Smartphone className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{app.appLabel}</p>
        <p className="text-xs text-muted-foreground">
          {app.todaySeconds > 0 ? fmtMinutes(app.todaySeconds) : 'без активности'} ·{' '}
          {CATEGORY_LABELS[app.category]}
          {app.isSystem ? ' · системное' : ''}
        </p>
      </div>
    </li>
  );
}

function EmptyAppsHint(): ReactElement {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-5 text-sm text-muted-foreground">
      <p>Список установленных приложений ещё не получен с устройства ребёнка.</p>
      <p className="mt-2">Возможные причины:</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          На устройстве не предоставлен доступ к статистике использования (Настройки → Особые
          разрешения → «Доступ к данным об использовании»).
        </li>
        <li>Прошло меньше 15 минут с момента включения — фоновая отправка ещё не сработала.</li>
        <li>У устройства нет интернет-соединения.</li>
      </ul>
    </div>
  );
}
