import type { Metadata } from 'next';
import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'GMD — сервис родительского контроля',
  description: 'Геолокация детей, геозоны, SOS-кнопка и экранное время',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="ru" className={cn('font-sans', geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
