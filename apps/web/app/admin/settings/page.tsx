import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { AdminClient } from '../admin-client';
import { SettingsClient } from './settings-client';

export default async function AdminSettingsPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  const version = process.env.APP_VERSION ?? 'dev';

  return (
    <AdminClient>
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-10">
        <nav className="mb-8 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          <span>Админка</span>
          <ChevronRight className="h-3 w-3 text-zinc-400" strokeWidth={2} />
          <span className="text-zinc-900">Параметры</span>
        </nav>

        <header className="mb-12 flex flex-col gap-6 border-b border-zinc-200 pb-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-sky-700">
              System configuration
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 md:text-5xl">
              Параметры системы
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-600">
              Глобальные настройки, действующие на все семьи. Значения кэшируются
              на&nbsp;1&nbsp;минуту — изменения применяются к&nbsp;следующим запросам.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 md:text-right">
            <dt className="md:order-1">Версия</dt>
            <dd className="text-zinc-900 md:order-2">v{version}</dd>
            <dt className="md:order-3">Шифрование</dt>
            <dd className="text-zinc-900 md:order-4">AES-256-GCM</dd>
          </dl>
        </header>

        <SettingsClient />
      </div>
    </AdminClient>
  );
}
