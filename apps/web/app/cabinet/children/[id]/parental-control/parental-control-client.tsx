'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  Check,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  formatDaysMask,
  HARDCODED_ALLOWED_PACKAGES,
  isScheduleActiveAt,
  rewriteIconUrl,
  type AppBlockScheduleDto,
  type AppCategory,
  type AppRuleMode,
  type BlockSessionDto,
  type InstalledAppDto,
  type UsageRangeDto,
} from '@/lib/api/app-control';
import {
  useActiveBlock,
  useAppRules,
  useDeleteSchedule,
  useInstalledApps,
  useSchedules,
  useStopBlock,
  useUpdateSchedule,
  useUpsertAppRule,
  useUsage,
} from '@/lib/hooks/use-app-control';
import { ApiError } from '@/lib/api/client';
import { BlockDialog } from '@/components/children/block-dialog';
import { ScheduleDialog } from '@/components/children/schedule-dialog';
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

export default function ParentalControlClient({
  childId,
  onBack,
}: {
  childId: string;
  /**
   * Если задан — кнопка «Назад» становится `<button>` и вызывает onBack()
   * вместо ссылки на /cabinet. Используется в embed-режиме (WebView mobile-
   * parent) — там Link на /cabinet нежелателен (история back уезжает на
   * страницу авторизации, а нам нужно закрыть всю WebView).
   */
  onBack?: () => void;
}): ReactElement {
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
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            title="Закрыть"
            aria-label="Закрыть"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <Link
            href="/cabinet"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            title="Назад"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        )}
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

      {/* v0.48: расписания автоблокировки (по дням и времени). */}
      <SchedulesSection childId={childId} />

      {/* v0.39.2: убрали отдельный AppsList — статистика и список приложений
          теперь в AppRulesSection (одна секция). */}
      <AppRulesSection
        childId={childId}
        apps={apps}
        rules={rules}
        usage={range ?? null}
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

// ─── App rules section (v0.39.1: search + 3-state allow/default/block) ──

type RuleFilter = 'all' | 'allowed' | 'default' | 'blocked';

interface RuleViewModel {
  packageName: string;
  appLabel: string;
  category: AppCategory | null;
  iconUrl: string | null;
  isSystem: boolean;
  /** Эффективный mode для UI: учитывает HARDCODED-приоритет. */
  mode: AppRuleMode;
  /** HARDCODED — нельзя менять (radio disabled, всегда ALWAYS_ALLOWED). */
  hardcoded: boolean;
  /** SYSTEM_DEFAULT — auto-разрешено системой, родитель может переопределить. */
  systemDefault: boolean;
  /** Активность за выбранный диапазон (today/yesterday/week). Используется
   *  как для сортировки, так и для отображения времени в карточке app. */
  seconds: number;
}

/**
 * Раздел «Правила приложений» (v0.39.1).
 *
 * Заменил старый бинарный whitelist (v0.39.0). Теперь для каждого приложения
 * родитель выбирает один из трёх режимов:
 *   - **Разрешено всегда** (ALWAYS_ALLOWED): не блокируется даже при активной
 *     BlockSession (whitelist — например, школьный мессенджер).
 *   - **По умолчанию** (DEFAULT): блокируется, только когда родитель явно
 *     запустил блок-сессию (Калькулятор, обычные приложения).
 *   - **Заблокировано всегда** (ALWAYS_BLOCKED): всегда заблокировано даже
 *     без активной сессии (например, TikTok, не для ребёнка). Эту опцию
 *     поддерживают backend и mobile-child с v0.39.0, но в UI родителя она
 *     появилась только сейчас.
 *
 * UX:
 *   - Поиск по названию app или package name (case-insensitive).
 *   - Фильтр-табы: Все / Разрешённые / По умолчанию / Заблокированные.
 *   - 3-state segmented control справа от каждого app: ✓ — ⛔
 *   - HARDCODED — segmented disabled (только ✓), pill «системное».
 */
function AppRulesSection({
  childId,
  apps,
  rules,
  usage,
  loading,
}: {
  childId: string;
  apps: InstalledAppDto[];
  rules: { packageName: string; mode: string; source: string }[];
  usage: UsageRangeDto | null;
  loading: boolean;
}): ReactElement {
  const upsert = useUpsertAppRule(childId);
  const [search, setSearch] = useState<string>('');
  const [filter, setFilter] = useState<RuleFilter>('all');

  const appByPkg = useMemo(() => {
    const map = new Map<string, InstalledAppDto>();
    for (const a of apps) map.set(a.packageName, a);
    return map;
  }, [apps]);

  const ruleByPkg = useMemo(() => {
    const map = new Map<string, { mode: string; source: string }>();
    for (const r of rules) map.set(r.packageName, { mode: r.mode, source: r.source });
    return map;
  }, [rules]);

  // Время за выбранный диапазон (today/yesterday/week) — приходит в
  // usage.byPackage. Map pkg → seconds используется и в карточке app, и в
  // сортировке. Если usage ещё не загрузился — fallback на todaySeconds
  // (актуально только для today; для yesterday/week — 0 пока ждём ответ).
  const secondsByPkg = useMemo(() => {
    const map = new Map<string, number>();
    if (usage) {
      for (const p of usage.byPackage) map.set(p.packageName, p.seconds);
    }
    return map;
  }, [usage]);

  // Собираем единый список: HARDCODED + все apps + любые rules без installed-app
  // (на случай если правило сохранено для удалённого app — пусть родитель
  // увидит и сможет почистить).
  const items = useMemo<RuleViewModel[]>(() => {
    const seen = new Set<string>();
    const out: RuleViewModel[] = [];

    const hardcodedSet = new Set<string>(HARDCODED_ALLOWED_PACKAGES);

    const push = (pkg: string): void => {
      if (seen.has(pkg)) return;
      seen.add(pkg);
      const a = appByPkg.get(pkg);
      const r = ruleByPkg.get(pkg);
      const isHardcoded = hardcodedSet.has(pkg);
      const isSystemDefault = r?.source === 'SYSTEM_DEFAULT';

      let mode: AppRuleMode;
      if (isHardcoded) {
        mode = 'ALWAYS_ALLOWED';
      } else if (r) {
        const m = r.mode;
        mode = m === 'ALWAYS_ALLOWED' || m === 'ALWAYS_BLOCKED' || m === 'DEFAULT' ? m : 'DEFAULT';
      } else {
        mode = 'DEFAULT';
      }

      // Активность за выбранный диапазон. Для today fallback на
      // todaySeconds (если range ещё не пришёл). Для yesterday/week без
      // ответа usage — 0.
      const seconds = secondsByPkg.get(pkg) ?? (usage ? 0 : (a?.todaySeconds ?? 0));

      out.push({
        packageName: pkg,
        appLabel: a?.appLabel ?? pkg,
        category: a?.category ?? null,
        iconUrl: a?.iconUrl ?? null,
        isSystem: a?.isSystem ?? false,
        seconds,
        mode,
        hardcoded: isHardcoded,
        systemDefault: isSystemDefault,
      });
    };

    // Порядок добавления — fallback при равенстве сортировки:
    // hardcoded сверху, затем installed apps, затем «orphan» rules.
    for (const pkg of HARDCODED_ALLOWED_PACKAGES) push(pkg);
    for (const a of apps) push(a.packageName);
    for (const r of rules) push(r.packageName);

    return out;
  }, [apps, appByPkg, rules, ruleByPkg, secondsByPkg, usage]);

  // Сортировка: hardcoded (системные неблокируемые) сверху → дальше по
  // активности за выбранный диапазон (самые «горячие» первыми) → алфавитно
  // среди приложений с одинаковыми (или нулевыми) секундами.
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.hardcoded !== b.hardcoded) return a.hardcoded ? -1 : 1;
      if (b.seconds !== a.seconds) return b.seconds - a.seconds;
      return a.appLabel.localeCompare(b.appLabel, 'ru');
    });
  }, [items]);

  // Применяем фильтры (search + tab)
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedItems.filter((it) => {
      if (q) {
        const hay = `${it.appLabel} ${it.packageName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === 'allowed') return it.mode === 'ALWAYS_ALLOWED';
      if (filter === 'blocked') return it.mode === 'ALWAYS_BLOCKED';
      if (filter === 'default') return it.mode === 'DEFAULT';
      return true;
    });
  }, [sortedItems, search, filter]);

  const counts = useMemo(() => {
    let allowed = 0,
      blocked = 0,
      def = 0;
    for (const it of items) {
      if (it.mode === 'ALWAYS_ALLOWED') allowed++;
      else if (it.mode === 'ALWAYS_BLOCKED') blocked++;
      else def++;
    }
    return { all: items.length, allowed, blocked, default: def };
  }, [items]);

  function onChangeMode(item: RuleViewModel, nextMode: AppRuleMode): void {
    if (item.hardcoded || upsert.isPending) return;
    if (item.mode === nextMode) return;
    upsert.mutate(
      { packageName: item.packageName, mode: nextMode },
      {
        onError: (err: unknown) => {
          toast.error(err instanceof Error ? err.message : 'Не удалось сохранить правило');
        },
      },
    );
  }

  // v0.39.2: один объединённый раздел вместо двух (раньше «Все приложения»
  // + «Не блокируется»). Если устройство ещё не прислало installed-apps —
  // показываем EmptyAppsHint баннер сверху, но сам список (хотя бы HARDCODED)
  // продолжаем рендерить, чтобы родитель видел уже доступные правила.
  const noAppsFromDevice = !loading && apps.length === 0;

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Приложения <span className="text-muted-foreground">({counts.all})</span>
        </h2>
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          title="Применяется через FCM high-priority push (≈5 сек). Если устройство офлайн — догонит через ≤15 мин при следующем поллинге."
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Применяется на устройстве за несколько секунд
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Для каждого приложения выбери: <b>Разрешено всегда</b> — работает даже при активной
        блокировке (whitelist), <b>По умолчанию</b> — блокируется только во время блок-сессии,{' '}
        <b>Заблокировано всегда</b> — заблокировано постоянно (даже без сессии). Звонки, SMS и
        камера всегда разрешены.
      </p>

      {/* Если apps пустой — показываем подсказку «почему» сверху, но не скрываем
          список (HARDCODED уже доступен). */}
      {noAppsFromDevice && (
        <div className="mb-3">
          <EmptyAppsHint />
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск приложений…"
          className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          aria-label="Поиск приложений"
        />
      </div>

      {/* Filter tabs */}
      <RulesFilterTabs current={filter} onChange={setFilter} counts={counts} />

      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Загрузка списка…</p>
      ) : filteredItems.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {search ? 'Нет приложений по запросу.' : 'Список приложений пуст.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {filteredItems.map((it) => (
            <AppRuleRow
              key={it.packageName}
              item={it}
              onChangeMode={(m) => onChangeMode(it, m)}
              busy={upsert.isPending}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RulesFilterTabs({
  current,
  onChange,
  counts,
}: {
  current: RuleFilter;
  onChange: (f: RuleFilter) => void;
  counts: { all: number; allowed: number; blocked: number; default: number };
}): ReactElement {
  const items: Array<{ key: RuleFilter; label: string; count: number }> = [
    { key: 'all', label: 'Все', count: counts.all },
    { key: 'allowed', label: 'Разрешённые', count: counts.allowed },
    { key: 'default', label: 'По умолчанию', count: counts.default },
    { key: 'blocked', label: 'Заблокированные', count: counts.blocked },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onChange(it.key)}
          className={
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
            (current === it.key
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-card text-foreground hover:bg-muted')
          }
        >
          {it.label}
          <span
            className={
              'rounded-full px-1.5 text-[10px] ' +
              (current === it.key
                ? 'bg-background/20 text-background'
                : 'bg-muted text-muted-foreground')
            }
          >
            {it.count}
          </span>
        </button>
      ))}
    </div>
  );
}

function AppRuleRow({
  item,
  onChangeMode,
  busy,
}: {
  item: RuleViewModel;
  onChangeMode: (mode: AppRuleMode) => void;
  busy: boolean;
}): ReactElement {
  const proxiedIcon = rewriteIconUrl(item.iconUrl);
  const timePart = item.seconds > 0 ? ` · ${fmtMinutes(item.seconds)}` : '';
  const subtitle = item.hardcoded
    ? 'Системное · нельзя заблокировать' + timePart
    : item.systemDefault
      ? 'По умолчанию разрешено системой' + timePart
      : item.category !== null
        ? CATEGORY_LABELS[item.category] + (item.isSystem ? ' · системное' : '') + timePart
        : item.packageName + timePart;

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
      <ModeSegmented
        value={item.mode}
        disabled={item.hardcoded}
        busy={busy}
        onChange={onChangeMode}
        appLabel={item.appLabel}
      />
    </li>
  );
}

/**
 * 3-state segmented control: ✓ (allow) | — (default) | ⛔ (block).
 *
 * Disabled (для HARDCODED) — кнопки серые, ✓ visually-active.
 *
 * Размер: компактный, 3×28px = ~84px ширины. Не помещаемся на ультрамалых
 * экранах (<360px), но эта страница в первую очередь для desktop.
 */
function ModeSegmented({
  value,
  disabled,
  busy,
  onChange,
  appLabel,
}: {
  value: AppRuleMode;
  disabled: boolean;
  busy: boolean;
  onChange: (mode: AppRuleMode) => void;
  appLabel: string;
}): ReactElement {
  const options: Array<{
    mode: AppRuleMode;
    icon: ReactElement;
    label: string;
    activeBg: string;
    activeText: string;
  }> = [
    {
      mode: 'ALWAYS_ALLOWED',
      icon: <Check className="h-3.5 w-3.5" aria-hidden />,
      label: 'Разрешено всегда',
      activeBg: 'bg-emerald-600',
      activeText: 'text-white',
    },
    {
      mode: 'DEFAULT',
      icon: (
        <span aria-hidden className="text-base leading-none">
          —
        </span>
      ),
      label: 'По умолчанию',
      activeBg: 'bg-muted-foreground/30',
      activeText: 'text-foreground',
    },
    {
      mode: 'ALWAYS_BLOCKED',
      icon: <Ban className="h-3.5 w-3.5" aria-hidden />,
      label: 'Заблокировано всегда',
      activeBg: 'bg-red-600',
      activeText: 'text-white',
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={`Режим блокировки для ${appLabel}`}
      className={
        'inline-flex shrink-0 overflow-hidden rounded-md border border-border ' +
        (disabled ? 'opacity-60' : '')
      }
    >
      {options.map((opt) => {
        const active = value === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${opt.label} — ${appLabel}`}
            title={opt.label}
            onClick={() => onChange(opt.mode)}
            disabled={disabled || busy}
            className={
              'flex h-7 w-7 items-center justify-center text-xs transition-colors ' +
              'border-r border-border last:border-r-0 ' +
              (active
                ? `${opt.activeBg} ${opt.activeText}`
                : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground') +
              (disabled
                ? ' cursor-not-allowed'
                : busy
                  ? ' disabled:cursor-wait'
                  : ' cursor-pointer')
            }
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

// ─── Schedules section (v0.48) ─────────────────────────────────────────

/**
 * Секция «Расписание блокировки» — список карточек расписаний + кнопка добавить.
 *
 * TZ ребёнка пока не пробрасывается на web (хранится в ChildDevice.timezone, не
 * в ChildDto). Для бейджа «Сейчас активно» используем TZ браузера родителя как
 * приближение — в типичном случае РФ-семьи родитель и ребёнок в одной TZ.
 * Реальное определение «попало ли в окно» делает устройство ребёнка локально
 * со своей TZ. Если родитель в другом TZ, бейдж может «опаздывать», но фактическая
 * блокировка корректна.
 */
function SchedulesSection({ childId }: { childId: string }): ReactElement {
  const q = useSchedules(childId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppBlockScheduleDto | undefined>(undefined);

  const schedules = q.data?.schedules ?? [];

  function openCreate(): void {
    setEditing(undefined);
    setDialogOpen(true);
  }
  function openEdit(s: AppBlockScheduleDto): void {
    setEditing(s);
    setDialogOpen(true);
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Расписание блокировки
            {schedules.length > 0 && (
              <span className="text-muted-foreground">({schedules.length})</span>
            )}
          </span>
        </h2>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Добавить
        </button>
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        Автоматическая блокировка приложений в указанные дни и часы. Whitelist (всегда разрешённые)
        и системные приложения работают; звонки и SMS — тоже.
      </p>

      {q.isPending && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {q.isError && (
        <p className="text-sm text-red-600">
          Не удалось загрузить расписания: {q.error instanceof Error ? q.error.message : 'ошибка'}
        </p>
      )}
      {!q.isPending && schedules.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-5 text-sm text-muted-foreground">
          Расписаний ещё нет. Например, можно добавить «Сон — каждый день с 22:00 до 08:00».
        </div>
      )}

      {schedules.length > 0 && (
        <ul className="space-y-2">
          {schedules.map((s) => (
            <ScheduleRow key={s.id} childId={childId} schedule={s} onEdit={() => openEdit(s)} />
          ))}
        </ul>
      )}

      <ScheduleDialog
        childId={childId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        schedule={editing}
      />
    </div>
  );
}

function ScheduleRow({
  childId,
  schedule,
  onEdit,
}: {
  childId: string;
  schedule: AppBlockScheduleDto;
  onEdit: () => void;
}): ReactElement {
  const update = useUpdateSchedule(childId);
  const del = useDeleteSchedule(childId);

  // Локальное «сейчас активно» — пересчитываем каждые 30 сек, плюс при mount.
  // TZ браузера родителя (см. комментарий выше).
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const activeNow = isScheduleActiveAt(schedule, now, browserTz);

  function toggle(): void {
    if (update.isPending) return;
    update.mutate(
      { scheduleId: schedule.id, body: { enabled: !schedule.enabled } },
      {
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : 'Не удалось изменить'),
      },
    );
  }

  function onDelete(): void {
    if (del.isPending) return;
    if (!window.confirm(`Удалить расписание «${schedule.name}»?`)) return;
    del.mutate(schedule.id, {
      onSuccess: () => toast.success('Расписание удалено'),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : 'Не удалось удалить'),
    });
  }

  return (
    <li
      className={
        'flex items-start gap-3 rounded-xl border bg-card p-3 ' +
        (schedule.enabled ? 'border-border' : 'border-dashed border-border/60 opacity-60')
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{schedule.name}</p>
          {activeNow && schedule.enabled && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              <Lock className="h-2.5 w-2.5" /> Сейчас активно
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDaysMask(schedule.daysMask)} · {schedule.startTime}—{schedule.endTime}
          {schedule.crossesMidnight && ' (через полночь)'}
        </p>
      </div>
      <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={toggle}
          disabled={update.isPending}
          className="h-4 w-4 cursor-pointer accent-blue-600"
          aria-label={schedule.enabled ? 'Выключить расписание' : 'Включить расписание'}
        />
      </label>
      <button
        type="button"
        onClick={onEdit}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Изменить"
        aria-label="Изменить расписание"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={del.isPending}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-wait dark:hover:bg-red-950/40"
        title="Удалить"
        aria-label="Удалить расписание"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
