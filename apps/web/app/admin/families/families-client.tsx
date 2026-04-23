'use client';

import { useEffect, useState } from 'react';
import { useAdminFamilies } from '@/lib/hooks/use-admin';
import { DataTable } from '@/components/admin/data-table';
import { FamilyActionsMenu } from '@/components/admin/family-actions-menu';
import type { FamilyRow } from '@/lib/api/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function StatusBadge({ row }: { row: FamilyRow }): React.ReactElement {
  if (row.deletedAt) {
    return (
      <Badge className="border-transparent bg-red-100 text-red-700 hover:bg-red-100">Удалена</Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
      Активна
    </Badge>
  );
}

const columns = [
  { key: 'name', header: 'Семья' },
  { key: 'status', header: 'Статус', render: (row: FamilyRow) => <StatusBadge row={row} /> },
  {
    key: 'createdAt',
    header: 'Создана',
    render: (row: FamilyRow) => new Date(row.createdAt).toLocaleString('ru'),
  },
  {
    key: 'deletedAt',
    header: 'Удалена',
    render: (row: FamilyRow) =>
      row.deletedAt ? (
        <span className="text-red-600">{new Date(row.deletedAt).toLocaleString('ru')}</span>
      ) : (
        '—'
      ),
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
  {
    key: 'actions',
    header: '',
    render: (row: FamilyRow) => (
      <div className="text-right">
        <FamilyActionsMenu row={row} />
      </div>
    ),
  },
] as const;

export function FamiliesClient() {
  const [page, setPage] = useState(1);
  const [inputQ, setInputQ] = useState('');
  const [q, setQ] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(inputQ);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [inputQ]);

  const { data, isLoading, error } = useAdminFamilies({ page, q, showDeleted });

  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Поиск по названию…"
          value={inputQ}
          onChange={(e) => setInputQ(e.target.value)}
          className="w-72 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => {
              setShowDeleted(e.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-slate-300"
          />
          Показывать удалённые
        </label>
        {data && <span className="text-sm text-slate-500">Всего: {data.total}</span>}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
      {error && <p className="text-sm text-red-600">Ошибка загрузки семей.</p>}

      {data && (
        <>
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
            <span className="text-sm text-muted-foreground">
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
