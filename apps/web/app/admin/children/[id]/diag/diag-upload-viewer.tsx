'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2, X } from 'lucide-react';
import { adminApi, type DiagUploadDetail } from '@/lib/api/admin';
import { adminChildDiagKey, adminDiagUploadKey, useAdminDiagUpload } from '@/lib/hooks/use-admin';
import {
  buildDiagTxt,
  diagFileName,
  filterLogLines,
  formatDateTime,
  formatSize,
  prettySnapshot,
  uploadReasonLabel,
  type LogLevelFilter,
} from '@/lib/admin/diag';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/admin/list-controls';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Tab = 'snapshot' | 'log' | 'logcat';

const TABS: { key: Tab; label: string }[] = [
  { key: 'snapshot', label: 'Снимок состояния' },
  { key: 'log', label: 'Журнал' },
  { key: 'logcat', label: 'logcat' },
];

const PRE =
  'max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground';

interface Props {
  uploadId: string;
  childId: string;
  onClose: () => void;
}

function downloadTxt(d: DiagUploadDetail): void {
  const blob = new Blob([buildDiagTxt(d)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = diagFileName(d);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Размер секции в байтах UTF-8 (как считает сервер), для подписи вкладки. */
function byteSize(text: string | null | undefined): number {
  return text ? new Blob([text]).size : 0;
}

export function DiagUploadViewer({ uploadId, childId, onClose }: Props) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useAdminDiagUpload(uploadId);
  const [tab, setTab] = useState<Tab>('log');
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LogLevelFilter>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const logText = data?.log ?? null;
  const logcatText = data?.logcat ?? null;

  const filteredLog = useMemo(
    () => (logText ? filterLogLines(logText, deferredQuery, level) : null),
    [logText, deferredQuery, level],
  );
  const filteredLogcat = useMemo(
    () => (logcatText ? filterLogLines(logcatText, deferredQuery, 'all') : null),
    [logcatText, deferredQuery],
  );
  const tabSizes = useMemo<Record<Tab, number>>(
    () => ({
      snapshot: byteSize(data?.snapshot),
      log: byteSize(data?.log),
      logcat: byteSize(data?.logcat),
    }),
    [data?.snapshot, data?.log, data?.logcat],
  );
  const snapshotText = useMemo(
    () => (data?.snapshot ? prettySnapshot(data.snapshot) : null),
    [data?.snapshot],
  );

  const deleteMut = useMutation({
    mutationFn: () => adminApi.deleteDiagUpload(uploadId),
    onSuccess: () => {
      toast.success('Журнал удалён');
      setConfirmDelete(false);
      qc.removeQueries({ queryKey: adminDiagUploadKey(uploadId) });
      void qc.invalidateQueries({ queryKey: adminChildDiagKey(childId) });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось удалить журнал'),
  });

  const filtered = tab === 'log' ? filteredLog : tab === 'logcat' ? filteredLogcat : null;

  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Просмотр журнала
          </h2>
          {data && (
            <p className="mt-1 text-sm text-foreground">
              {formatDateTime(data.createdAt)} · {uploadReasonLabel(data)} ·{' '}
              {data.appVersion ?? 'версия —'} · {formatSize(data.sizeBytes)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={!data}
            onClick={() => data && downloadTxt(data)}
          >
            <Download className="h-3.5 w-3.5" />
            Скачать .txt
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={!data || deleteMut.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Удалить
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label="Закрыть просмотр"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загружаем журнал…</p>}
      {error && (
        <p className="text-sm text-destructive">
          Не удалось загрузить журнал: {error.message || 'ошибка сервера'}.
        </p>
      )}

      {data && (
        <>
          <div role="tablist" className="mb-3 inline-flex rounded-md border border-border p-0.5">
            {TABS.map((t) => {
              const size = tabSizes[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm transition-colors',
                    tab === t.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {t.label}
                  {size > 0 && (
                    <span className="ml-1 text-xs opacity-75">· {formatSize(size)}</span>
                  )}
                </button>
              );
            })}
          </div>

          {tab !== 'snapshot' && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <SearchInput value={query} onChange={setQuery} placeholder="Найти в строках…" />
              {tab === 'log' && (
                <select
                  aria-label="Уровень записей"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as LogLevelFilter)}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="all">Все уровни</option>
                  <option value="I">I — обычные</option>
                  <option value="D">D — подробные</option>
                </select>
              )}
              {filtered && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Показано {filtered.lines.length} из {filtered.total} строк
                </span>
              )}
            </div>
          )}

          {tab === 'snapshot' &&
            (snapshotText ? (
              <pre className={PRE}>{snapshotText}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                Снимка нет — включите «Прикладывать снимок состояния».
              </p>
            ))}
          {tab === 'log' &&
            (filteredLog ? (
              <pre className={PRE}>{filteredLog.lines.join('\n') || 'Ничего не найдено'}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">Журнал пуст.</p>
            ))}
          {tab === 'logcat' &&
            (filteredLogcat ? (
              <pre className={PRE}>{filteredLogcat.lines.join('\n') || 'Ничего не найдено'}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                logcat не приложен — включите «Прикладывать logcat».
              </p>
            ))}
        </>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить журнал?</DialogTitle>
            <DialogDescription>
              Журнал от {formatDateTime(data?.createdAt)} будет удалён безвозвратно.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate()}
            >
              {deleteMut.isPending ? 'Удаляем…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
