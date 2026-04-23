import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminClient } from '../admin-client';
import { InvitesClient } from './invites-client';

export default async function AdminInvitesPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  return (
    <AdminClient>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-foreground">Активные инвайты</h1>
        <InvitesClient />
      </div>
    </AdminClient>
  );
}
