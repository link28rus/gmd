'use client';

import { useEffect, useState } from 'react';
import { useAdminFamilies } from '@/lib/hooks/use-admin';
import { useTableSort } from '@/lib/hooks/use-table-sort';
import { DataTable, type Column } from '@/components/admin/data-table';
import { FamilyActionsMenu } from '@/components/admin/family-actions-menu';
import { FamilyStatusBadge } from '@/components/admin/badges';
import {
  ExportCsvButton,
  ListToolbar,
  Pagination,
  SearchInput,
  ToggleFilter,
} from '@/components/admin/list-controls';
import { exportRowsToCsv } from '@/lib/admin/csv';
import type { FamilyRow, FamilySortField } from '@/lib/api/admin';

export function FamiliesClient() {
  const [page, setPage] = useState(1);
  const [inputQ, setInputQ] = useState('');
  const [q, setQ] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const { sort, toggle } = useTableSort<FamilySortField>({ by: 'createdAt', dir: 'desc' });

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(inputQ);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [inputQ]);

  const { data, isLoading, error } = useAdminFamilies({
    page,
    q,
    showDeleted,
    sortBy: sort.by,
    sortDir: sort.dir,
  });

  const columns: Column<FamilyRow>[] = [
    { key: 'name', header: 'Семья', sortKey: 'name', cellClassName: 'font-medium' },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => <FamilyStatusBadge deletedAt={row.deletedAt} />,
    },
    {
      key: 'createdAt',
      header: 'Создана',
      sortKey: 'createdAt',
      cellClassName: 'text-muted-foreground',
      render: (row) => new Date(row.createdAt).toLocaleDateString('ru'),
    },
    {
      key: 'deletedAt',
      header: 'Удалена',
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
      key: 'membersCount',
      header: 'Участники',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (row) => String(row.membersCount),
    },
    {
      key: 'childrenCount',
      header: 'Дети',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (row) => String(row.childrenCount),
    },
    {
      key: 'activeDevicesCount',
      header: 'Устройств',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (row) => String(row.activeDevicesCount),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => <FamilyActionsMenu row={row} />,
    },
  ];

  function handleExport(): void {
    if (!data) return;
    exportRowsToCsv<FamilyRow>(
      `families-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Семья', value: (r) => r.name },
        { header: 'Статус', value: (r) => (r.deletedAt ? 'Удалена' : 'Активна') },
        { header: 'Создана', value: (r) => r.createdAt },
        { header: 'Удалена', value: (r) => r.deletedAt ?? '' },
        { header: 'Участники', value: (r) => r.membersCount },
        { header: 'Дети', value: (r) => r.childrenCount },
        { header: 'Активных устройств', value: (r) => r.activeDevicesCount },
      ],
      data.items,
    );
  }

  return (
    <div>
      <ListToolbar>
        <SearchInput value={inputQ} onChange={setInputQ} placeholder="Поиск по названию…" />
        <ToggleFilter
          checked={showDeleted}
          onChange={(v) => {
            setShowDeleted(v);
            setPage(1);
          }}
        >
          Показывать удалённые
        </ToggleFilter>
        <div className="ml-auto">
          <ExportCsvButton onClick={handleExport} disabled={!data || data.items.length === 0} />
        </div>
      </ListToolbar>

      {isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
      {error && <p className="text-sm text-destructive">Ошибка загрузки семей.</p>}

      {data && (
        <>
          <DataTable
            columns={columns}
            rows={data.items}
            empty="Нет семей"
            sort={sort}
            onSort={toggle}
            rowKey={(row) => (row as FamilyRow).id}
          />
          <Pagination page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
    </div>
  );
}
