import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/providers/query-provider';
import { AdminHeader } from '@/components/admin/admin-header';
import { ThemeProvider } from '@/components/theme/theme-provider';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const hasRefresh = Boolean(cookieStore.get('gmd_refresh')?.value);
  if (!hasRefresh) redirect('/login');

  return (
    <ThemeProvider>
      <QueryProvider>
        <div className="flex min-h-svh flex-col bg-background text-foreground">
          <AdminHeader />
          <main className="flex-1">{children}</main>
        </div>
        <Toaster richColors position="top-right" />
      </QueryProvider>
    </ThemeProvider>
  );
}
