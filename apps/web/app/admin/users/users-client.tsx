'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminUsers } from '@/lib/hooks/use-admin';
import { useAuthStore } from '@/lib/auth-store';
import { DataTable } from '@/components/admin/data-table';
import { UserActionsMenu } from '@/components/admin/user-actions-menu';
import { Badge } from '@/components/ui/badge';
import type { UserRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';

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

function RoleBadge({ role }: { role: UserRow['role'] }): React.ReactElement {
  if (role === 'admin') {
    return (
      <Badge className="border-transparent bg-sky-100 text-sky-700 hover:bg-sky-100">Админ</Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-slate-100 text-slate-700 hover:bg-slate-100">
      Родитель
    </Badge>
  );
}

function StatusBadge({ row }: { row: UserRow }): React.ReactElement {
  if (row.deletedAt) {
    return (
      <Badge className="border-transparent bg-red-100 text-red-700 hover:bg-red-100">Удалён</Badge>
    );
  }
  if (row.blockedAt) {
    return (
      <Badge
        className="border-transparent bg-amber-100 text-amber-700 hover:bg-amber-100"
        title={row.blockedReason ?? undefined}
      >
        Заблокирован
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
      Активен
    </Badge>
  );
}

export function UsersClient() {
  const [page, setPage] = useState(1);
  const [inputQ, setInputQ] = useState('');
  const [q, setQ] = useState('');
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(inputQ);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [inputQ]);

  const { data, isLoading, error } = useAdminUsers({ page, q });

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  const columns = [
    {
      key: 'email',
      header: 'Email',
      render: (row: UserRow) => (
        <Link href={`/admin/users/${row.id}`} className="text-sky-600 hover:underline">
          {row.email}
        </Link>
      ),
    },
    { key: 'name', header: 'ФИО', render: (row: UserRow) => row.name ?? '—' },
    { key: 'role', header: 'Роль', render: (row: UserRow) => <RoleBadge role={row.role} /> },
    { key: 'status', header: 'Статус', render: (row: UserRow) => <StatusBadge row={row} /> },
    {
      key: 'familyName',
      header: 'Семья',
      render: (row: UserRow) => row.familyName ?? '—',
    },
    {
      key: 'lastSeenAt',
      header: 'Последний заход',
      render: (row: UserRow) => (
        <span className="text-slate-600" title={row.lastSeenAt ?? undefined}>
          {fmtLastSeen(row.lastSeenAt)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Создан',
      render: (row: UserRow) => new Date(row.createdAt).toLocaleDateString('ru'),
    },
    {
      key: 'actions',
      header: '',
      render: (row: UserRow) => (
        <div className="text-right">
          <UserActionsMenu row={row} currentUserId={currentUserId} />
        </div>
      ),
    },
  ] as const;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="text"
          placeholder="Поиск по email…"
          value={inputQ}
          onChange={(e) => setInputQ(e.target.value)}
          className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
        />
        {data && <span className="text-sm text-slate-500">Всего: {data.total}</span>}
      </div>

      {isLoading && <p className="text-sm text-slate-400">Загружаем…</p>}
      {error && <p className="text-sm text-red-600">Ошибка загрузки пользователей.</p>}

      {data && (
        <>
          <DataTable
            columns={columns as unknown as Parameters<typeof DataTable>[0]['columns']}
            rows={data.items as unknown as Record<string, unknown>[]}
            empty="Нет пользователей"
          />
          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Назад
            </Button>
            <span className="text-sm text-slate-600">
              Страница {page} из {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Вперёд
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
