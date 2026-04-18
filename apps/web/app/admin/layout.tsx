import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/providers/query-provider';
import { AdminHeader } from '@/components/admin/admin-header';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const hasRefresh = Boolean(cookieStore.get('gmd_refresh')?.value);
  if (!hasRefresh) redirect('/login');

  return (
    <QueryProvider>
      <AdminHeader />
      <main className="min-h-[calc(100vh-44px)] bg-zinc-50">{children}</main>
      <Toaster richColors position="top-right" />
    </QueryProvider>
  );
}
