import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/providers/query-provider';
import { CabinetHeader } from '@/components/cabinet/cabinet-header';
import { ConsentBannerSlot } from '@/components/cabinet/consent-banner-slot';
import { PendingFamilyInviteRedirect } from '@/components/cabinet/pending-family-invite-redirect';
import { ThemeProvider } from '@/components/theme/theme-provider';

export default function CabinetLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <CabinetHeader />
        <ConsentBannerSlot />
        <PendingFamilyInviteRedirect />
        <main className="min-h-[calc(100vh-57px)] bg-background text-foreground">{children}</main>
        <Toaster richColors position="top-right" />
      </QueryProvider>
    </ThemeProvider>
  );
}
