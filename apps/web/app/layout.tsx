import type { Metadata } from 'next';
import './globals.css';
// Leaflet CSS — глобально, чтобы tiles/controls правильно позиционировались.
// Без этого .leaflet-container не имеет width:100%/height:100% и плитки рисуются
// «не там». Импорт в client-component 'use client' через Next.js 15 не работает
// надёжно — поэтому делаем здесь.
import 'leaflet/dist/leaflet.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { Footer } from '@/components/layout/footer';

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
      <body className="flex min-h-screen flex-col">
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
