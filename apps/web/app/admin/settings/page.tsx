import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminClient } from '../admin-client';
import { SettingsClient } from './settings-client';

export default async function AdminSettingsPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  return (
    <AdminClient>
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="mb-2 text-2xl font-semibold text-zinc-900">Параметры системы</h1>
        <p className="mb-6 text-sm text-zinc-600">
          Глобальные настройки, которые применяются ко всем семьям. Изменения вступают в силу в
          течение минуты (кэш настроек).
        </p>
        <SettingsClient />
      </div>
    </AdminClient>
  );
}
