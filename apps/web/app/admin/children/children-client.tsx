'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useAdminChildren } from '@/lib/hooks/use-admin';
import { useTableSort } from '@/lib/hooks/use-table-sort';
import { DataTable, type Column } from '@/components/admin/data-table';
import { ChildActionsMenu } from '@/components/admin/child-actions-menu';
import { DeviceBadge } from '@/components/admin/badges';
import {
  ExportCsvButton,
  ListToolbar,
  Pagination,
  SearchInput,
  ToggleFilter,
} from '@/components/admin/list-controls';
import { exportRowsToCsv } from '@/lib/admin/csv';
import type { AdminChildRow, ChildSortField } from '@/lib/api/admin';

const DEVICE_LABEL: Record<AdminChildRow['deviceStatus'], string> = {
  online: 'Онлайн',
  offline: 'Офлайн',
  revoked: 'Отозвано',
  none: 'Не привязано',
};

export function ChildrenClient() {
  const [page, setPage] = useState(1);
  const [inputQ, setInputQ] = useState('');
  const [q, setQ] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const { sort, toggle } = useTableSort<ChildSortField>({ by: 'createdAt', dir: 'desc' });

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(inputQ);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [inputQ]);

  const { data, isLoading, error } = useAdminChildren({
    page,
    q,
    showDeleted,
    sortBy: sort.by,
    sortDir: sort.dir,
  });

  const columns: Column<AdminChildRow>[] = [
    { key: 'name', header: 'Имя ребёнка', sortKey: 'name' },
    {
      key: 'dateOfBirth',
      header: 'Дата рождения',
      sortKey: 'dateOfBirth',
      cellClassName: 'text-muted-foreground',
      render: (row) => (row.dateOfBirth ? new Date(row.dateOfBirth).toLocaleDateString('ru') : '—'),
    },
    { key: 'familyName', header: 'Семья' },
    {
      key: 'deviceStatus',
      header: 'Устройство',
      render: (row) => <DeviceBadge status={row.deviceStatus} />,
    },
    {
      key: 'deviceLastSeenAt',
      header: 'Последний онлайн',
      cellClassName: 'text-muted-foreground',
      render: (row) =>
        row.deviceLastSeenAt ? new Date(row.deviceLastSeenAt).toLocaleString('ru') : '—',
    },
    {
      key: 'deletedAt',
      header: 'Удалён',
      sortKey: 'deletedAt',
      render: (row) =>
        row.deletedAt ? (
          <span className="text-destructive">
            {new Date(row.deletedAt).toLocaleDateString('ru')}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'diag',
      header: '',
      align: 'right',
      render: (row) => (
        <Link
          href={`/admin/children/${row.id}/diag?name=${encodeURIComponent(row.name)}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          title="Журнал приложения ребёнка"
        >
          <FileText className="h-3.5 w-3.5" />
          Журнал
        </Link>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => <ChildActionsMenu row={row} />,
    },
  ];

  function handleExport(): void {
    if (!data) return;
    exportRowsToCsv<AdminChildRow>(
      `children-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Имя', value: (r) => r.name },
        { header: 'Дата рождения', value: (r) => r.dateOfBirth ?? '' },
        { header: 'Семья', value: (r) => r.familyName },
        { header: 'Устройство', value: (r) => DEVICE_LABEL[r.deviceStatus] },
        { header: 'Последний онлайн', value: (r) => r.deviceLastSeenAt ?? '' },
        { header: 'Удалён', value: (r) => r.deletedAt ?? '' },
      ],
      data.items,
    );
  }

  return (
    <div>
      <ListToolbar>
        <SearchInput value={inputQ} onChange={setInputQ} placeholder="Поиск по имени…" />
        <ToggleFilter
          checked={showDeleted}
          onChange={(v) => {
            setShowDeleted(v);
            setPage(1);
          }}
        >
          Показывать удалённых
        </ToggleFilter>
        <div className="ml-auto">
          <ExportCsvButton onClick={handleExport} disabled={!data || data.items.length === 0} />
        </div>
      </ListToolbar>

      {isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
      {error && <p className="text-sm text-destructive">Ошибка загрузки детей.</p>}

      {data && (
        <>
          <DataTable
            columns={columns}
            rows={data.items}
            empty="Нет детей"
            sort={sort}
            onSort={toggle}
            rowKey={(row) => (row as AdminChildRow).id}
          />
          <Pagination page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
    </div>
  );
}
