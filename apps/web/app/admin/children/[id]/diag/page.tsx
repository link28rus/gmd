import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DiagClient } from './diag-client';

export default async function AdminChildDiagPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ name?: string | string[] }>;
}) {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')?.value) redirect('/login');

  const { id } = await params;
  // Имя ребёнка приходит из ссылки списка (?name=) — в ответе /diag его нет.
  const sp = await searchParams;
  const rawName = (Array.isArray(sp.name) ? sp.name[0] : sp.name)?.trim();
  const name = rawName ? rawName.slice(0, 100) : null;

  return <DiagClient id={id} name={name} />;
}
