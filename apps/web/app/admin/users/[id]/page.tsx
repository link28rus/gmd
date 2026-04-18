import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { UserDetailClient } from './user-detail-client';

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  const { id } = await params;
  return <UserDetailClient id={id} />;
}
