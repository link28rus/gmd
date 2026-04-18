import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminClient } from '../admin-client';
import { ChildrenClient } from './children-client';

export default async function AdminChildrenPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  return (
    <AdminClient>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Дети</h1>
        <ChildrenClient />
      </div>
    </AdminClient>
  );
}
