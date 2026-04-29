import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/theme/theme-provider';

/**
 * Минималистичный layout для embed-страниц, открываемых внутри WebView
 * мобильного приложения родителя. БЕЗ CabinetHeader / consent-баннеров —
 * только ThemeProvider + QueryProvider + Toaster, чтобы экран занимал
 * всё доступное место WebView.
 */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <main className="min-h-screen bg-background text-foreground">{children}</main>
        <Toaster richColors position="top-center" />
      </QueryProvider>
    </ThemeProvider>
  );
}
