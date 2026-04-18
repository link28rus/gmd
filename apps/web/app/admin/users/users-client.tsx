'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAdminUsers } from '@/lib/hooks/use-admin';
import { DataTable } from '@/components/admin/data-table';
import type { UserRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';

export function UsersClient() {
  const [page, setPage] = useState(1);
  const [inputQ, setInputQ] = useState('');
  const [q, setQ] = useState('');

  // Debounce search 300ms
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
        <Link href={`/admin/users/${row.id}`} className="text-blue-600 hover:underline">
          {row.email}
        </Link>
      ),
    },
    { key: 'name', header: 'Имя', render: (row: UserRow) => row.name ?? '—' },
    {
      key: 'familyName',
      header: 'Семья',
      render: (row: UserRow) => row.familyName ?? '—',
    },
    {
      key: 'childrenCount',
      header: 'Дети',
      render: (row: UserRow) => String(row.childrenCount),
    },
    {
      key: 'createdAt',
      header: 'Создан',
      render: (row: UserRow) => new Date(row.createdAt).toLocaleString('ru'),
    },
    {
      key: 'deletedAt',
      header: 'Удалён',
      render: (row: UserRow) =>
        row.deletedAt ? (
          <span className="text-red-600">{new Date(row.deletedAt).toLocaleString('ru')}</span>
        ) : (
          '—'
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
          className="w-72 rounded-md border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-zinc-500"
        />
        {data && <span className="text-sm text-zinc-500">Всего: {data.total}</span>}
      </div>

      {isLoading && <p className="text-sm text-zinc-400">Загружаем…</p>}
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
            <span className="text-sm text-zinc-600">
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
