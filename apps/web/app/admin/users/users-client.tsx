'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminUsers } from '@/lib/hooks/use-admin';
import { useAuthStore } from '@/lib/auth-store';
import { useTableSort } from '@/lib/hooks/use-table-sort';
import { DataTable, type Column } from '@/components/admin/data-table';
import { UserActionsMenu } from '@/components/admin/user-actions-menu';
import { RoleBadge, UserStatusBadge } from '@/components/admin/badges';
import {
  ExportCsvButton,
  ListToolbar,
  Pagination,
  SearchInput,
  ToggleFilter,
} from '@/components/admin/list-controls';
import { exportRowsToCsv } from '@/lib/admin/csv';
import type { UserRow, UserSortField } from '@/lib/api/admin';

function fmtLastSeen(iso: string | null): string {
  if (!iso) return 'ни разу';
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'вчера';
  if (day < 7) return `${day} дн назад`;
  return new Date(iso).toLocaleDateString('ru');
}

export function UsersClient() {
  const [page, setPage] = useState(1);
  const [inputQ, setInputQ] = useState('');
  const [q, setQ] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const { sort, toggle } = useTableSort<UserSortField>({ by: 'createdAt', dir: 'desc' });
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(inputQ);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [inputQ]);

  const { data, isLoading, error } = useAdminUsers({
    page,
    q,
    showDeleted,
    sortBy: sort.by,
    sortDir: sort.dir,
  });

  const columns: Column<UserRow>[] = [
    {
      key: 'email',
      header: 'Email',
      sortKey: 'email',
      render: (row) => (
        <Link href={`/admin/users/${row.id}`} className="font-medium text-primary hover:underline">
          {row.email}
        </Link>
      ),
    },
    { key: 'name', header: 'ФИО', sortKey: 'name', render: (row) => row.name ?? '—' },
    {
      key: 'role',
      header: 'Роль',
      sortKey: 'role',
      render: (row) => <RoleBadge role={row.role} />,
    },
    {
      key: 'status',
      header: 'Статус',
      render: (row) => (
        <UserStatusBadge
          deletedAt={row.deletedAt}
          blockedAt={row.blockedAt}
          blockedReason={row.blockedReason}
        />
      ),
    },
    { key: 'familyName', header: 'Семья', render: (row) => row.familyName ?? '—' },
    {
      key: 'childrenCount',
      header: 'Дети',
      align: 'right',
      cellClassName: 'tabular-nums text-muted-foreground',
      render: (row) => (row.childrenCount > 0 ? String(row.childrenCount) : '—'),
    },
    {
      key: 'lastSeenAt',
      header: 'Заход',
      sortKey: 'lastSeenAt',
      cellClassName: 'text-muted-foreground',
      render: (row) => (
        <span title={row.lastSeenAt ?? undefined}>{fmtLastSeen(row.lastSeenAt)}</span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Создан',
      sortKey: 'createdAt',
      cellClassName: 'text-muted-foreground',
      render: (row) => new Date(row.createdAt).toLocaleDateString('ru'),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => <UserActionsMenu row={row} currentUserId={currentUserId} />,
    },
  ];

  function handleExport(): void {
    if (!data) return;
    exportRowsToCsv<UserRow>(
      `users-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Email', value: (r) => r.email },
        { header: 'ФИО', value: (r) => r.name ?? '' },
        { header: 'Роль', value: (r) => (r.role === 'admin' ? 'Админ' : 'Родитель') },
        {
          header: 'Статус',
          value: (r) => (r.deletedAt ? 'Удалён' : r.blockedAt ? 'Заблокирован' : 'Активен'),
        },
        { header: 'Семья', value: (r) => r.familyName ?? '' },
        { header: 'Дети', value: (r) => r.childrenCount },
        { header: 'Последний заход', value: (r) => r.lastSeenAt ?? '' },
        { header: 'Создан', value: (r) => r.createdAt },
      ],
      data.items,
    );
  }

  return (
    <div>
      <ListToolbar>
        <SearchInput value={inputQ} onChange={setInputQ} placeholder="Поиск по email…" />
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
      {error && <p className="text-sm text-destructive">Ошибка загрузки пользователей.</p>}

      {data && (
        <>
          <DataTable
            columns={columns}
            rows={data.items}
            empty="Нет пользователей"
            sort={sort}
            onSort={toggle}
            rowKey={(row) => (row as UserRow).id}
          />
          <Pagination page={page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
    </div>
  );
}
