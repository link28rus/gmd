import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminClient } from './admin-client';
import { StatsDashboard } from './stats-dashboard';

export default async function AdminPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  return (
    <AdminClient>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Обзор</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Сводка по пользователям, семьям, детям и устройствам сервиса.
          </p>
        </header>
        <StatsDashboard />
      </div>
    </AdminClient>
  );
}
