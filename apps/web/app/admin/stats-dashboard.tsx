'use client';

import { useAdminStats } from '@/lib/hooks/use-admin';

interface StatCardProps {
  title: string;
  rows: { label: string; value: number | string }[];
}

function StatCard({ title, rows }: StatCardProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <dl className="space-y-1">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between">
            <dt className="text-sm text-zinc-600">{label}</dt>
            <dd className="text-lg font-bold text-zinc-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function StatsDashboard() {
  const { data, isLoading, error } = useAdminStats();

  if (isLoading) {
    return <p className="text-sm text-zinc-400">Загружаем статистику…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-sm text-red-600">
        Ошибка загрузки статистики. Проверьте что вы администратор и backend запущен.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Пользователи"
        rows={[
          { label: 'Всего', value: data.users.total },
          { label: 'Удалено', value: data.users.deleted },
        ]}
      />
      <StatCard title="Семьи" rows={[{ label: 'Всего', value: data.families.total }]} />
      <StatCard
        title="Дети"
        rows={[
          { label: 'Всего', value: data.children.total },
          { label: 'Удалено', value: data.children.deleted },
        ]}
      />
      <StatCard
        title="Устройства"
        rows={[
          { label: 'Всего', value: data.devices.total },
          { label: 'Активных', value: data.devices.active },
          { label: 'Отозвано', value: data.devices.revoked },
        ]}
      />
      <StatCard
        title="Инвайты"
        rows={[
          { label: 'Всего', value: data.invites.total },
          { label: 'Активных сейчас', value: data.invites.activeNow },
        ]}
      />
    </div>
  );
}
