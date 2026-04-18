import Link from 'next/link';
import type { ReactElement } from 'react';

export default function HomePage(): ReactElement {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <h1 className="text-4xl font-bold mb-4">GMD</h1>
      <p className="text-lg text-gray-400 mb-8">Сервис родительского контроля и геолокации детей</p>
      <Link
        href="/login"
        className="inline-block rounded-md bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Войти
      </Link>
      <p className="mt-8 text-xs text-gray-500">v0.4.1 — MVP</p>
    </main>
  );
}
