'use client';

import { useState } from 'react';
import { useAdminChildren } from '@/lib/hooks/use-admin';
import { DataTable } from '@/components/admin/data-table';
import { Badge } from '@/components/ui/badge';
import type { AdminChildRow } from '@/lib/api/admin';
import { Button } from '@/components/ui/button';

function DeviceBadge({ status }: { status: AdminChildRow['deviceStatus'] }) {
  const map: Record<
    AdminChildRow['deviceStatus'],
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    online: { label: 'Онлайн', variant: 'default' },
    offline: { label: 'Офлайн', variant: 'secondary' },
    revoked: { label: 'Отозвано', variant: 'secondary' },
    none: { label: 'Не привязано', variant: 'outline' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const columns = [
  { key: 'name', header: 'Имя ребёнка' },
  {
    key: 'dateOfBirth',
    header: 'Дата рождения',
    render: (row: AdminChildRow) =>
      row.dateOfBirth ? new Date(row.dateOfBirth).toLocaleDateString('ru') : '—',
  },
  { key: 'familyName', header: 'Семья' },
  {
    key: 'deviceStatus',
    header: 'Устройство',
    render: (row: AdminChildRow) => <DeviceBadge status={row.deviceStatus} />,
  },
  {
    key: 'deviceLastSeenAt',
    header: 'Последний онлайн',
    render: (row: AdminChildRow) =>
      row.deviceLastSeenAt ? new Date(row.deviceLastSeenAt).toLocaleString('ru') : '—',
  },
  {
    key: 'deletedAt',
    header: 'Удалён',
    render: (row: AdminChildRow) =>
      row.deletedAt ? (
        <span className="text-red-600">{new Date(row.deletedAt).toLocaleString('ru')}</span>
      ) : (
        '—'
      ),
  },
] as const;

export function ChildrenClient() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useAdminChildren({ page });

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  return (
    <div>
      {isLoading && <p className="text-sm text-zinc-400">Загружаем…</p>}
      {error && <p className="text-sm text-red-600">Ошибка загрузки детей.</p>}

      {data && (
        <>
          <p className="mb-3 text-sm text-zinc-500">Всего: {data.total}</p>
          <DataTable
            columns={columns as unknown as Parameters<typeof DataTable>[0]['columns']}
            rows={data.items as unknown as Record<string, unknown>[]}
            empty="Нет детей"
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
