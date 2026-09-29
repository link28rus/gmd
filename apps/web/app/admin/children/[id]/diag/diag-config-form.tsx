'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  adminApi,
  DEFAULT_DIAG_CONFIG,
  DIAG_CATEGORIES,
  type AdminChildDiag,
  type DiagCategory,
  type DiagConfig,
} from '@/lib/api/admin';
import { adminChildDiagKey } from '@/lib/hooks/use-admin';
import {
  DEBUG_DURATION_LABEL,
  DIAG_CATEGORY_LABEL,
  debugState,
  formatDateTime,
  initialDebugDuration,
  normalizeCategories,
  resolveDebugUntil,
  type DebugDuration,
} from '@/lib/admin/diag';
import { Button } from '@/components/ui/button';

interface Props {
  childId: string;
  config: DiagConfig;
  hasDevice: boolean;
}

const CHECKBOX = 'h-4 w-4 rounded border-input accent-primary disabled:opacity-50';

function Toggle({
  checked,
  onChange,
  disabled,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer select-none items-start gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 ${CHECKBOX}`}
      />
      <span>
        {children}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function DebugStatusLine({ config }: { config: DiagConfig }) {
  const s = debugState(config, Date.now());
  switch (s.kind) {
    case 'off':
      return <span className="text-muted-foreground">Подробный режим выключен</span>;
    case 'forever':
      return <span className="text-amber-700 dark:text-amber-400">Подробный режим без срока</span>;
    case 'until':
      return (
        <span className="text-emerald-700 dark:text-emerald-400">
          Подробный режим до {s.until.toLocaleString('ru')}
        </span>
      );
    case 'expired':
      return (
        <span className="text-muted-foreground">
          Подробный режим истёк {s.until.toLocaleString('ru')}
        </span>
      );
  }
}

export function DiagConfigForm({ childId, config, hasDevice }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DiagConfig>(config);
  const [duration, setDuration] = useState<DebugDuration>(() => initialDebugDuration(config));
  const [dirty, setDirty] = useState(false);
  const [delivered, setDelivered] = useState<boolean | null>(null);

  // Настройки на сервере поменялись (сохранение, другой админ) — подтягиваем,
  // если админ ничего не правил. Паттерн «state from props» без эффекта.
  const serverKey = JSON.stringify(config);
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    if (!dirty) {
      setDraft(config);
      setDuration(initialDebugDuration(config));
    }
  }

  const saveMut = useMutation({
    mutationFn: (next: DiagConfig) => adminApi.updateChildDiagConfig(childId, next),
    onSuccess: (r) => {
      qc.setQueryData<AdminChildDiag>(adminChildDiagKey(childId), (old) =>
        old ? { ...old, config: r.config } : old,
      );
      setDraft(r.config);
      setDuration(initialDebugDuration(r.config));
      setDirty(false);
      setDelivered(r.delivered);
      toast.success(
        r.delivered
          ? 'Настройки доставлены на телефон'
          : 'Настройки сохранены — применятся при подключении',
      );
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось сохранить настройки'),
  });

  function edit(patch: Partial<DiagConfig>): void {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setDelivered(null);
  }

  function toggleCategory(field: 'send' | 'debug', cat: DiagCategory, on: boolean): void {
    const current = draft[field];
    const next = on ? [...current, cat] : current.filter((c) => c !== cat);
    edit({ [field]: normalizeCategories(next, DIAG_CATEGORIES) });
  }

  function save(): void {
    const debug = normalizeCategories(draft.debug, DIAG_CATEGORIES);
    saveMut.mutate({
      ...draft,
      send: normalizeCategories(draft.send, DIAG_CATEGORIES),
      debug,
      debugUntil:
        debug.length === 0 ? null : resolveDebugUntil(duration, config.debugUntil, Date.now()),
    });
  }

  function disableDebug(): void {
    saveMut.mutate({
      ...config,
      debug: [...DEFAULT_DIAG_CONFIG.debug],
      debugUntil: DEFAULT_DIAG_CONFIG.debugUntil,
      logcat: DEFAULT_DIAG_CONFIG.logcat,
    });
  }

  const disabled = !hasDevice || saveMut.isPending;
  const current = debugState(config, Date.now());
  const keepExpired = duration === 'keep' && current.kind === 'expired' && draft.debug.length > 0;
  const allSend = draft.send.length === DIAG_CATEGORIES.length;

  return (
    <div className="space-y-5">
      {!hasDevice && (
        <p className="text-sm text-muted-foreground">
          Устройство не привязано — настройки журнала хранятся у устройства.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium text-muted-foreground">Категория</th>
              <th className="w-32 px-3 py-2 text-center font-medium text-muted-foreground">
                Отправлять
              </th>
              <th className="w-32 px-3 py-2 text-center font-medium text-muted-foreground">
                Подробно
              </th>
            </tr>
          </thead>
          <tbody>
            {DIAG_CATEGORIES.map((cat) => (
              <tr key={cat} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-foreground">
                  {DIAG_CATEGORY_LABEL[cat]}{' '}
                  <code className="ml-1 text-[11px] text-muted-foreground">{cat}</code>
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Отправлять: ${DIAG_CATEGORY_LABEL[cat]}`}
                    checked={draft.send.includes(cat)}
                    disabled={disabled}
                    onChange={(e) => toggleCategory('send', cat, e.target.checked)}
                    className={CHECKBOX}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Подробно: ${DIAG_CATEGORY_LABEL[cat]}`}
                    checked={draft.debug.includes(cat)}
                    disabled={disabled}
                    onChange={(e) => toggleCategory('debug', cat, e.target.checked)}
                    className={CHECKBOX}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!allSend && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Снятые категории не попадут в отправляемый журнал (на телефоне записи остаются).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="diag-debug-duration" className="text-muted-foreground">
          Срок подробного режима
        </label>
        <select
          id="diag-debug-duration"
          value={duration}
          disabled={disabled}
          onChange={(e) => {
            setDuration(e.target.value as DebugDuration);
            setDirty(true);
            setDelivered(null);
          }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        >
          {config.debugUntil && (
            <option value="keep">
              Не менять ({current.kind === 'expired' ? 'истёк' : 'до'}{' '}
              {formatDateTime(config.debugUntil)})
            </option>
          )}
          {(['1h', '24h', '3d', 'none'] as const).map((d) => (
            <option key={d} value={d}>
              {DEBUG_DURATION_LABEL[d]}
            </option>
          ))}
        </select>
        <DebugStatusLine config={config} />
      </div>
      {keepExpired && (
        <p className="-mt-3 text-xs text-amber-700 dark:text-amber-400">
          Срок истёк — выберите новый, иначе подробные записи писаться не будут.
        </p>
      )}
      {draft.debug.length > 0 && duration === 'none' && (
        <p className="-mt-3 text-xs text-amber-700 dark:text-amber-400">
          Без срока подробный режим останется включённым, пока его не выключат вручную.
        </p>
      )}

      <div className="space-y-2">
        <Toggle
          checked={draft.logcat}
          disabled={disabled}
          onChange={(v) => edit({ logcat: v })}
          hint="Системный logcat процесса приложения — объёмный, включайте на время отладки."
        >
          Прикладывать logcat
        </Toggle>
        <Toggle
          checked={draft.snapshot}
          disabled={disabled}
          onChange={(v) => edit({ snapshot: v })}
        >
          Прикладывать снимок состояния
        </Toggle>
        <Toggle
          checked={draft.autoUpload}
          disabled={disabled}
          onChange={(v) => edit({ autoUpload: v })}
          hint="Не чаще раза в 30 минут на один сбой и не больше 6 журналов в сутки."
        >
          Отправлять сам при сбоях
        </Toggle>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button disabled={disabled || !dirty} onClick={save}>
          {saveMut.isPending ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={disableDebug}
          title="Подробный режим и logcat — к значениям по умолчанию"
        >
          Выключить отладку
        </Button>
        {dirty && (
          <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>
        )}
        {!dirty && delivered === true && (
          <span className="text-sm text-emerald-700 dark:text-emerald-400">
            Настройки доставлены на телефон
          </span>
        )}
        {!dirty && delivered === false && (
          <span className="text-sm text-amber-700 dark:text-amber-400">
            Телефон не на связи — применятся при подключении
          </span>
        )}
      </div>
    </div>
  );
}
