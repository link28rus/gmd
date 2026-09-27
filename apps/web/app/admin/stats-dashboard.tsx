'use client';

import { Users, Home, Baby, Smartphone, Ticket, type LucideIcon } from 'lucide-react';
import { useAdminStats } from '@/lib/hooks/use-admin';

interface StatCardProps {
  title: string;
  icon: LucideIcon;
  primary: { label: string; value: number };
  secondary?: { label: string; value: number }[];
}

function StatCard({ title, icon: Icon, primary, secondary = [] }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-foreground">{primary.value}</span>
        <span className="text-xs text-muted-foreground">{primary.label}</span>
      </div>

      {secondary.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3">
          {secondary.map(({ label, value }) => (
            <div key={label} className="text-xs text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{value}</span> {label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatsDashboard() {
  const { data, isLoading, error } = useAdminStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[112px] animate-pulse rounded-xl border border-border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        Ошибка загрузки статистики. Проверьте что вы администратор и backend запущен.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Пользователи"
        icon={Users}
        primary={{ label: 'всего', value: data.users.total }}
        secondary={[{ label: 'удалено', value: data.users.deleted }]}
      />
      <StatCard
        title="Семьи"
        icon={Home}
        primary={{ label: 'всего', value: data.families.total }}
      />
      <StatCard
        title="Дети"
        icon={Baby}
        primary={{ label: 'всего', value: data.children.total }}
        secondary={[{ label: 'удалено', value: data.children.deleted }]}
      />
      <StatCard
        title="Устройства"
        icon={Smartphone}
        primary={{ label: 'всего', value: data.devices.total }}
        secondary={[
          { label: 'активных', value: data.devices.active },
          { label: 'отозвано', value: data.devices.revoked },
        ]}
      />
      <StatCard
        title="Приглашения"
        icon={Ticket}
        primary={{ label: 'всего', value: data.invites.total }}
        secondary={[{ label: 'активных сейчас', value: data.invites.activeNow }]}
      />
    </div>
  );
}
