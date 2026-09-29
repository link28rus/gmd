'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, RefreshCw, Send } from 'lucide-react';
import { adminApi, type AdminChildDiag, type DiagUploadRow } from '@/lib/api/admin';
import { adminChildDiagKey, useAdminChildDiag } from '@/lib/hooks/use-admin';
import {
  MIN_DIAG_APP_VERSION,
  formatDateTime,
  formatSize,
  supportsDiag,
  uploadReasonLabel,
} from '@/lib/admin/diag';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/admin/badges';
import { DataTable, type Column } from '@/components/admin/data-table';
import { AdminClient } from '../../../admin-client';
import { DiagConfigForm } from './diag-config-form';
import { DiagUploadViewer } from './diag-upload-viewer';

/** Опрос после «Запросить журнал»: раз в 5 с, не дольше 2 минут. */
const POLL_INTERVAL_MS = 5_000;
const POLL_WINDOW_MS = 2 * 60_000;

interface Props {
  id: string;
  name: string | null;
}

interface PollState {
  until: number;
  /** id журналов, которые уже были на момент запроса. */
  baseline: string[];
}

type RequestNote =
  | { kind: 'sent'; delivered: boolean; expiresAt: string; timedOut: boolean }
  | { kind: 'arrived'; at: string };

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-border py-2 last:border-0">
      <dt className="w-48 shrink-0 text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function DeviceSection({
  id,
  name,
  device,
}: {
  id: string;
  name: string | null;
  device: AdminChildDiag['device'];
}) {
  const supported = supportsDiag(device?.appVersion);
  return (
    <Section title="Устройство">
      <dl>
        <Row
          label="Ребёнок"
          value={name ?? <code className="text-xs text-muted-foreground">{id}</code>}
        />
        {device ? (
          <>
            <Row label="Версия приложения" value={device.appVersion ?? '—'} />
            <Row
              label="Связь"
              value={
                device.online ? (
                  <Pill tone="emerald" dot>
                    На связи
                  </Pill>
                ) : (
                  <Pill tone="slate" dot>
                    Не на связи
                  </Pill>
                )
              }
            />
            <Row label="Последний раз был" value={formatDateTime(device.lastSeenAt)} />
          </>
        ) : (
          <Row label="Устройство" value="Не привязано" />
        )}
      </dl>
      {supported === false ? (
        <p className="mt-3 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Версия {device?.appVersion} не понимает запрос журнала. Нужна версия приложения{' '}
          {MIN_DIAG_APP_VERSION} или новее.
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Нужна версия приложения {MIN_DIAG_APP_VERSION} или новее.
        </p>
      )}
    </Section>
  );
}

function RequestStatus({
  note,
  polling,
  pending,
  onRecheck,
}: {
  note: RequestNote | null;
  polling: boolean;
  pending: AdminChildDiag['pendingRequest'];
  onRecheck: () => void;
}) {
  if (note?.kind === 'arrived') {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        Журнал получен {formatDateTime(note.at)}.
      </p>
    );
  }
  if (note?.kind === 'sent') {
    return (
      <div className="space-y-1 text-sm">
        <p className={note.delivered ? 'text-foreground' : 'text-amber-700 dark:text-amber-400'}>
          {note.delivered
            ? 'Команда доставлена, журнал придёт в течение минуты.'
            : `Телефон не на связи — команда уйдёт, когда он подключится (ждём до ${formatDateTime(
                note.expiresAt,
              )}).`}
        </p>
        {polling && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Проверяем каждые 5 секунд…
          </p>
        )}
        {note.timedOut && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Журнал за 2 минуты не пришёл — он появится в списке, когда телефон его отправит.
            <button type="button" onClick={onRecheck} className="text-primary hover:underline">
              Проверить сейчас
            </button>
          </p>
        )}
      </div>
    );
  }
  if (pending) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Есть невыполненный запрос журнала от {formatDateTime(pending.createdAt)} — телефон отправит
        журнал, когда получит команду (ждём до {formatDateTime(pending.expiresAt)}).
      </p>
    );
  }
  return null;
}

function DiagInner({ id, name }: Props) {
  const qc = useQueryClient();
  const [poll, setPoll] = useState<PollState | null>(null);
  const [note, setNote] = useState<RequestNote | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useAdminChildDiag(
    id,
    poll ? POLL_INTERVAL_MS : false,
  );

  // Новый журнал по запросу появился — прекращаем опрос и сразу открываем его.
  useEffect(() => {
    if (!poll || !data) return;
    const fresh = data.uploads.find((u) => u.reason === 'manual' && !poll.baseline.includes(u.id));
    if (!fresh) return;
    setPoll(null);
    setNote({ kind: 'arrived', at: fresh.createdAt });
    setSelectedId(fresh.id);
    toast.success('Журнал получен');
  }, [poll, data]);

  // Опрос не дольше POLL_WINDOW_MS.
  useEffect(() => {
    if (!poll) return;
    const t = window.setTimeout(
      () => {
        setPoll(null);
        setNote((n) => (n?.kind === 'sent' ? { ...n, timedOut: true } : n));
      },
      Math.max(0, poll.until - Date.now()),
    );
    return () => window.clearTimeout(t);
  }, [poll]);

  useEffect(() => {
    if (selectedId) viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedId]);

  const requestMut = useMutation({
    mutationFn: (_baseline: string[]) => adminApi.requestChildDiag(id),
    onSuccess: (r, baseline) => {
      setNote({ kind: 'sent', delivered: r.delivered, expiresAt: r.expiresAt, timedOut: false });
      setPoll({ until: Date.now() + POLL_WINDOW_MS, baseline });
      void qc.invalidateQueries({ queryKey: adminChildDiagKey(id) });
    },
    onError: (e: Error) => toast.error(e.message || 'Не удалось запросить журнал'),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Загружаем…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-destructive">
        Не удалось загрузить журнал ребёнка: {error?.message ?? 'ошибка сервера'}.
      </p>
    );

  const columns: Column<DiagUploadRow>[] = [
    {
      key: 'createdAt',
      header: 'Время',
      render: (row) => formatDateTime(row.createdAt),
    },
    { key: 'reason', header: 'Причина', render: (row) => uploadReasonLabel(row) },
    {
      key: 'appVersion',
      header: 'Версия',
      cellClassName: 'text-muted-foreground',
      render: (row) => row.appVersion ?? '—',
    },
    {
      key: 'sizeBytes',
      header: 'Размер',
      cellClassName: 'text-muted-foreground tabular-nums',
      render: (row) => formatSize(row.sizeBytes),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      render: (row) =>
        row.id === selectedId ? (
          <span className="text-xs text-muted-foreground">Открыт ниже</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setSelectedId(row.id)}
          >
            <FileText className="h-3.5 w-3.5" />
            Открыть
          </Button>
        ),
    },
  ];

  const polling = poll !== null;

  return (
    <div>
      <DeviceSection id={id} name={name} device={data.device} />

      <Section title="Запрос журнала">
        <div className="flex flex-wrap items-start gap-4">
          <Button
            className="gap-1.5"
            disabled={!data.device || requestMut.isPending || polling}
            onClick={() => requestMut.mutate(data.uploads.map((u) => u.id))}
          >
            {requestMut.isPending || polling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Запросить журнал
          </Button>
          <div className="min-w-0 flex-1 pt-2">
            {!data.device ? (
              <p className="text-sm text-muted-foreground">
                Устройство не привязано — запрашивать не у кого.
              </p>
            ) : (
              <RequestStatus
                note={note}
                polling={polling}
                pending={data.pendingRequest}
                onRecheck={() => void refetch()}
              />
            )}
          </div>
        </div>
      </Section>

      <Section title="Настройки журнала">
        <DiagConfigForm childId={id} config={data.config} hasDevice={data.device !== null} />
      </Section>

      <Section
        title="Журналы"
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            Обновить
          </Button>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Хранятся 14 дней, не больше 30 на устройство.
        </p>
        <DataTable
          columns={columns}
          rows={data.uploads}
          empty="Журналов пока нет"
          rowKey={(row) => row.id}
        />
      </Section>

      <div ref={viewerRef} className="scroll-mt-4">
        {selectedId && (
          <DiagUploadViewer
            key={selectedId}
            uploadId={selectedId}
            childId={id}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

export function DiagClient({ id, name }: Props) {
  return (
    <AdminClient>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-4">
          <Link href="/admin/children" className="text-sm text-primary hover:underline">
            &larr; Назад к списку детей
          </Link>
        </div>
        <h1 className="mb-1 text-2xl font-semibold text-foreground">Журнал приложения ребёнка</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {name ?? 'Ребёнок'} — диагностический журнал телефона: запрос, настройки и просмотр.
        </p>
        <DiagInner id={id} name={name} />
      </div>
    </AdminClient>
  );
}
