'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { ArrowLeft, Lock, ShieldCheck, Smartphone, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import {
  HARDCODED_ALLOWED_PACKAGES,
  rewriteIconUrl,
  type AppCategory,
  type BlockSessionDto,
  type InstalledAppDto,
  type UsageRangeDto,
} from '@/lib/api/app-control';
import {
  useActiveBlock,
  useAppRules,
  useInstalledApps,
  useStopBlock,
  useUpsertAppRule,
  useUsage,
} from '@/lib/hooks/use-app-control';
import { ApiError } from '@/lib/api/client';
import { BlockDialog } from '@/components/children/block-dialog';
import { useChildren } from '@/lib/hooks/use-children';

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
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);

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
  const activeBlockQ = useActiveBlock(childId);
  const rulesQ = useAppRules(childId);

  const range = usageQ.data?.result;
  const apps = appsQ.data?.apps ?? [];
  const activeBlock = activeBlockQ.data ?? null;
  const rules = rulesQ.data?.rules ?? [];

  // Имя ребёнка для диалога — берём из useChildren (cached одним fetch'ем для
  // всего кабинета). Если ещё не загружено или не нашлось — fallback «ребёнка».
  const childrenQ = useChildren();
  const childName = useMemo(() => {
    const c = childrenQ.data?.children.find((x) => x.id === childId);
    return c?.name ?? 'ребёнка';
  }, [childrenQ.data, childId]);

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

      {/* v0.39: активная блокировка показывается всегда (не зависит от таб'а) */}
      {activeBlock && <ActiveBlockCard childId={childId} session={activeBlock} />}

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

      {/* v0.39: рабочая кнопка «Заблокировать». Если блок уже активен —
          скрываем (управление сверху на ActiveBlockCard). */}
      {!activeBlock && (
        <BlockButton disabled={appsQ.isPending} onClick={() => setBlockDialogOpen(true)} />
      )}

      <AppsList apps={apps} loading={appsQ.isPending} />

      <WhitelistSection
        childId={childId}
        apps={apps}
        rules={rules}
        loading={appsQ.isPending || rulesQ.isPending}
      />

      <BlockDialog
        childId={childId}
        childName={childName}
        open={blockDialogOpen}
        onOpenChange={setBlockDialogOpen}
      />
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

// ─── Block button (v0.39) ───────────────────────────────────────────────

function BlockButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
    >
      <Lock className="h-4 w-4" />
      Заблокировать приложения
    </button>
  );
}

// ─── ActiveBlockCard (v0.39) ────────────────────────────────────────────

/**
 * Показывается сверху страницы, если есть ACTIVE сессия. Содержит:
 *   - countdown «осталось X ч Y мин» (обновляется каждую секунду на клиенте)
 *   - кнопку «Снять блок» (DELETE block-sessions)
 *   - локальное время окончания (для прозрачности)
 *
 * Когда счётчик доходит до 00:00 — показываем «Истекает…» 1-2 секунды,
 * затем useActiveBlock через poll/onSuccess получит null и компонент
 * исчезнет.
 */
function ActiveBlockCard({
  childId,
  session,
}: {
  childId: string;
  session: BlockSessionDto;
}): ReactElement {
  const [remainingMs, setRemainingMs] = useState<number>(
    Math.max(0, new Date(session.endsAt).getTime() - Date.now()),
  );
  const stopBlock = useStopBlock(childId);

  useEffect(() => {
    const endsAtMs = new Date(session.endsAt).getTime();
    const tick = (): void => {
      setRemainingMs(Math.max(0, endsAtMs - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session.endsAt]);

  const remainingMin = Math.floor(remainingMs / 60_000);
  const remainingSec = Math.floor((remainingMs % 60_000) / 1000);
  const countdown =
    remainingMin >= 60
      ? `${Math.floor(remainingMin / 60)} ч ${remainingMin % 60} мин`
      : remainingMin > 0
        ? `${remainingMin} мин ${remainingSec.toString().padStart(2, '0')} сек`
        : `${remainingSec} сек`;

  const endsAtLocal = new Date(session.endsAt).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  function onStop(): void {
    if (stopBlock.isPending) return;
    stopBlock.mutate(session.sessionId, {
      onSuccess: () => {
        toast.success('Блокировка снята');
      },
      onError: (err: unknown) => {
        if (err instanceof ApiError && err.code === 'session_not_found') {
          // Уже истекла или была снята с другого устройства — UI обновится
          // через 30-сек poll, ничего не делаем.
          toast.info('Блокировка уже неактивна');
        } else {
          toast.error(err instanceof Error ? err.message : 'Не удалось снять блокировку');
        }
      },
    });
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            Приложения заблокированы
          </p>
          <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">
            Осталось {remainingMs > 0 ? countdown : 'почти 0'} · до {endsAtLocal}
          </p>
        </div>
        <button
          type="button"
          onClick={onStop}
          disabled={stopBlock.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-card px-3 py-1.5 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-900/40"
        >
          <Unlock className="h-3.5 w-3.5" />
          {stopBlock.isPending ? 'Снимаем…' : 'Снять блок'}
        </button>
      </div>
    </div>
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

// ─── Whitelist section (v0.39: «Не блокируется») ────────────────────────

interface RuleViewModel {
  packageName: string;
  appLabel: string;
  category: AppCategory | null;
  iconUrl: string | null;
  isSystem: boolean;
  /** Текущий mode для отображения: 'ALWAYS_ALLOWED' = в whitelist, иначе нет. */
  inWhitelist: boolean;
  /** HARDCODED — нельзя выключить (dim toggle). */
  hardcoded: boolean;
  /** SYSTEM_DEFAULT — родитель может явно выключить, но это редко нужно. */
  systemDefault: boolean;
}

/**
 * Список «Не блокируется». Отображает все installed-apps + все правила
 * (PARENT/SYSTEM_DEFAULT) + HARDCODED — даже если их нет в installed-apps
 * (наш child app + MAX могут быть единственными во whitelist на свежем
 * устройстве).
 *
 * UX:
 *   - Toggle ON = в whitelist (mode=ALWAYS_ALLOWED, source=PARENT)
 *   - Toggle OFF = убирается из whitelist (mode=DEFAULT, source=PARENT)
 *   - HARDCODED — toggle disabled, всегда ON, метка «системное»
 *   - SYSTEM_DEFAULT — toggle активен (родитель может выключить, но мы
 *     показываем подсказку «по умолчанию разрешено»)
 *
 * При активной BlockSession список «Не блокируется» — это ровно те apps,
 * которые продолжают работать на устройстве ребёнка.
 */
function WhitelistSection({
  childId,
  apps,
  rules,
  loading,
}: {
  childId: string;
  apps: InstalledAppDto[];
  rules: { packageName: string; mode: string; source: string }[];
  loading: boolean;
}): ReactElement {
  const upsert = useUpsertAppRule(childId);

  const appByPkg = useMemo(() => {
    const map = new Map<string, InstalledAppDto>();
    for (const a of apps) map.set(a.packageName, a);
    return map;
  }, [apps]);

  // Собираем единый список: HARDCODED + SYSTEM_DEFAULT + PARENT-rules + все apps
  const items = useMemo<RuleViewModel[]>(() => {
    const seen = new Set<string>();
    const out: RuleViewModel[] = [];

    const push = (
      pkg: string,
      hardcoded: boolean,
      systemDefault: boolean,
      explicitAllowed: boolean,
    ): void => {
      if (seen.has(pkg)) return;
      seen.add(pkg);
      const a = appByPkg.get(pkg);
      out.push({
        packageName: pkg,
        appLabel: a?.appLabel ?? pkg,
        category: a?.category ?? null,
        iconUrl: a?.iconUrl ?? null,
        isSystem: a?.isSystem ?? false,
        inWhitelist: hardcoded || systemDefault || explicitAllowed,
        hardcoded,
        systemDefault,
      });
    };

    // 1. HARDCODED
    for (const pkg of HARDCODED_ALLOWED_PACKAGES) push(pkg, true, false, false);
    // 2. SYSTEM_DEFAULT (auto-разрешённые системные dialer/sms/etc)
    for (const r of rules) {
      if (r.source === 'SYSTEM_DEFAULT' && r.mode === 'ALWAYS_ALLOWED')
        push(r.packageName, false, true, false);
    }
    // 3. PARENT rules (родительский whitelist)
    for (const r of rules) {
      if (r.source === 'PARENT' && r.mode === 'ALWAYS_ALLOWED') {
        push(r.packageName, false, false, true);
      }
    }
    // 4. Все остальные installed apps (toggle OFF, чтобы родитель мог включить)
    for (const a of apps) push(a.packageName, false, false, false);

    return out;
  }, [apps, appByPkg, rules]);

  // Подсчитаем сколько в whitelist
  const inWhitelistCount = items.filter((i) => i.inWhitelist).length;

  function onToggle(item: RuleViewModel): void {
    if (item.hardcoded || upsert.isPending) return;
    const nextMode = item.inWhitelist ? 'DEFAULT' : 'ALWAYS_ALLOWED';
    upsert.mutate(
      { packageName: item.packageName, mode: nextMode },
      {
        onSuccess: () => {
          // Тосты для частых действий слишком навязчивы — короткий sonner.success
          // при первом включении был бы избыточен. Полагаемся на визуальный feedback
          // toggle.
        },
        onError: (err: unknown) => {
          toast.error(err instanceof Error ? err.message : 'Не удалось сохранить правило');
        },
      },
    );
  }

  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Не блокируется <span className="text-muted-foreground">({inWhitelistCount})</span>
        </h2>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Работает даже при блокировке
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Звонки, SMS, камера и наше приложение всегда доступны. Включи приложения, которые ребёнок
        должен иметь возможность открыть даже когда всё остальное заблокировано.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка списка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Список приложений ещё не получен.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <WhitelistRow
              key={it.packageName}
              item={it}
              onToggle={() => onToggle(it)}
              busy={upsert.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WhitelistRow({
  item,
  onToggle,
  busy,
}: {
  item: RuleViewModel;
  onToggle: () => void;
  busy: boolean;
}): ReactElement {
  const proxiedIcon = rewriteIconUrl(item.iconUrl);
  const subtitle = item.hardcoded
    ? 'Системное · всегда разрешено'
    : item.systemDefault
      ? 'По умолчанию разрешено'
      : item.category !== null
        ? CATEGORY_LABELS[item.category] + (item.isSystem ? ' · системное' : '')
        : item.packageName;

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
        ) : item.hardcoded ? (
          <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />
        ) : (
          <Smartphone className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.appLabel}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={item.inWhitelist}
        aria-label={
          item.inWhitelist
            ? `Убрать ${item.appLabel} из «Не блокируется»`
            : `Добавить ${item.appLabel} в «Не блокируется»`
        }
        onClick={onToggle}
        disabled={item.hardcoded || busy}
        className={
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed ' +
          (item.inWhitelist ? 'bg-emerald-600' : 'bg-muted') +
          (item.hardcoded ? ' opacity-60' : '') +
          (busy ? ' disabled:cursor-wait' : '')
        }
        title={
          item.hardcoded ? 'Это приложение всегда разрешено и не может быть выключено' : undefined
        }
      >
        <span
          className={
            'inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ' +
            (item.inWhitelist ? 'translate-x-4' : 'translate-x-0.5')
          }
        />
      </button>
    </li>
  );
}
