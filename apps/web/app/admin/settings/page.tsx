import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminClient } from '../admin-client';
import { SettingsClient } from './settings-client';

export default async function AdminSettingsPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  return (
    <AdminClient>
      <div className="mx-auto w-full max-w-[720px] px-6 pb-16 pt-10">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Параметры системы</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Глобальные настройки. Кэшируются на&nbsp;минуту — изменения применяются
            к&nbsp;следующим&nbsp;запросам.
          </p>
        </header>
        <SettingsClient />
      </div>
    </AdminClient>
  );
}
