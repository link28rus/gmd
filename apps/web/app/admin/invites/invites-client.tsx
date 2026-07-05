'use client';

import { useEffect, useState } from 'react';
import { useAdminInvites } from '@/lib/hooks/use-admin';
import { DataTable, type Column } from '@/components/admin/data-table';
import { InviteActionsMenu } from '@/components/admin/invite-actions-menu';
import { Pill } from '@/components/admin/badges';
import {
  ExportCsvButton,
  ListToolbar,
  Pagination,
  SearchInput,
} from '@/components/admin/list-controls';
import { exportRowsToCsv } from '@/lib/admin/csv';
import type { InviteRow } from '@/lib/api/admin';

function timeToExpire(expiresAt: string): { label: string; soon: boolean } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Истёк', soon: true };
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return { label: `${mins} мин`, soon: true };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { label: `${hours} ч`, soon: hours < 3 };
  return { label: `${Math.floor(hours / 24)} дн`, soon: false };
}

export function InvitesClient() {
  const [page, setPage] = useState(1);
  const [inputQ, setInputQ] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(inputQ);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [inputQ]);

  const { data, isLoading, error } = useAdminInvites({ page, q });

  const columns: Column<InviteRow>[] = [
    {
      key: 'code',
      header: 'Код',
      render: (row) => (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {row.code}
        </code>
      ),
    },
    { key: 'childName', header: 'Ребёнок', render: (row) => row.childName || '—' },
    { key: 'familyName', header: 'Семья', render: (row) => row.familyName || '—' },
    {
      key: 'expiresAt',
      header: 'Истекает через',
      render: (row) => {
        const { label, soon } = timeToExpire(row.expiresAt);
        return (
          <span className={soon ? 'text-amber-600 dark:text-amber-400' : undefined}>{label}</span>
        );
      },
    },
    {
      key: 'uses',
      header: 'Использований',
      render: (row) =>
        row.maxUses > 1 ? (
          <Pill tone="violet" title="Многоразовый инвайт">
            {row.usesCount}/{row.maxUses}
          </Pill>
        ) : (
          <span className="text-muted-foreground">разовый</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Создан',
      cellClassName: 'text-muted-foreground',
      render: (row) => new Date(row.createdAt).toLocaleString('ru'),
    },
    {
      key: 'createdByEmail',
      header: 'Создал',
      cellClassName: 'text-muted-foreground',
      render: (row) => row.createdByEmail ?? '—',
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => <InviteActionsMenu row={row} />,
    },
  ];

  function handleExport(): void {
    if (!data) return;
    exportRowsToCsv<InviteRow>(
      `invites-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Код', value: (r) => r.code },
        { header: 'Ребёнок', value: (r) => r.childName },
        { header: 'Семья', value: (r) => r.familyName },
        { header: 'Истекает', value: (r) => r.expiresAt },
        { header: 'Использований', value: (r) => `${r.usesCount}/${r.maxUses}` },
        { header: 'Создан', value: (r) => r.createdAt },
        { header: 'Создал', value: (r) => r.createdByEmail ?? '' },
      ],
      data.items,
    );
  }

  return (
    <div>
      <ListToolbar>
        <SearchInput
          value={inputQ}
          onChange={setInputQ}
          placeholder="Поиск по коду, ребёнку, семье…"
        />
        <div className="ml-auto">
          <ExportCsvButton onClick={handleExport} disabled={!data || data.items.length === 0} />
        </div>
      </ListToolbar>

      {isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
      {error && <p className="text-sm text-destructive">Ошибка загрузки инвайтов.</p>}

      {data && (
        <>
          <DataTable
            columns={columns}
            rows={data.items}
            empty="Нет активных инвайтов"
            rowKey={(row) => (row as InviteRow).id}
          />
          <Pagination page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
    </div>
  );
}
