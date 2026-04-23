'use client';

import { useAdminInvites } from '@/lib/hooks/use-admin';
import { DataTable } from '@/components/admin/data-table';
import type { InviteRow } from '@/lib/api/admin';

function timeToExpire(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Истёк';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

const columns = [
  {
    key: 'code',
    header: 'Код',
    render: (row: InviteRow) => (
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{row.code}</code>
    ),
  },
  { key: 'childName', header: 'Ребёнок' },
  { key: 'familyName', header: 'Семья' },
  {
    key: 'expiresAt',
    header: 'Истекает через',
    render: (row: InviteRow) => timeToExpire(row.expiresAt),
  },
  {
    key: 'createdAt',
    header: 'Создан',
    render: (row: InviteRow) => new Date(row.createdAt).toLocaleString('ru'),
  },
  { key: 'createdByEmail', header: 'Создал' },
] as const;

export function InvitesClient() {
  const { data, isLoading, error } = useAdminInvites();

  return (
    <div>
      {isLoading && <p className="text-sm text-muted-foreground">Загружаем…</p>}
      {error && <p className="text-sm text-red-600">Ошибка загрузки инвайтов.</p>}

      {data && (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Активных инвайтов: {data.items.length}
          </p>
          <DataTable
            columns={columns as unknown as Parameters<typeof DataTable>[0]['columns']}
            rows={data.items as unknown as Record<string, unknown>[]}
            empty="Нет активных инвайтов"
          />
        </>
      )}
    </div>
  );
}
