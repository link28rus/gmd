import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
