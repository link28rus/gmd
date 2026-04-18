import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/providers/query-provider';
import { CabinetHeader } from '@/components/cabinet/cabinet-header';

export default function CabinetLayout({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <CabinetHeader />
      <main className="min-h-[calc(100vh-57px)] bg-zinc-50">{children}</main>
      <Toaster richColors position="top-right" />
    </QueryProvider>
  );
}
