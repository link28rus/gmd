'use client';

import { useState } from 'react';
import { useAdminFamilies } from '@/lib/hooks/use-admin';
import { DataTable } from '@/components/admin/data-table';
import type { FamilyRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';

const columns = [
  { key: 'name', header: 'Семья' },
  {
    key: 'createdAt',
    header: 'Создана',
    render: (row: FamilyRow) => new Date(row.createdAt).toLocaleString('ru'),
  },
  {
    key: 'membersCount',
    header: 'Участники',
    render: (row: FamilyRow) => String(row.membersCount),
  },
  {
    key: 'childrenCount',
    header: 'Дети',
    render: (row: FamilyRow) => String(row.childrenCount),
  },
  {
    key: 'activeDevicesCount',
    header: 'Активных устройств',
    render: (row: FamilyRow) => String(row.activeDevicesCount),
  },
] as const;

export function FamiliesClient() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useAdminFamilies({ page });

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  return (
    <div>
      {isLoading && <p className="text-sm text-zinc-400">Загружаем…</p>}
      {error && <p className="text-sm text-red-600">Ошибка загрузки семей.</p>}

      {data && (
        <>
          <p className="mb-3 text-sm text-zinc-500">Всего: {data.total}</p>
          <DataTable
            columns={columns as unknown as Parameters<typeof DataTable>[0]['columns']}
            rows={data.items as unknown as Record<string, unknown>[]}
            empty="Нет семей"
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
