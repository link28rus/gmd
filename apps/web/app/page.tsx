import Link from 'next/link';
import type { ReactElement } from 'react';

const APP_VERSION = process.env.APP_VERSION ?? '';

export default function HomePage(): ReactElement {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-end px-6 py-4">
        <Link
          href="/download"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Скачать приложение
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <h1 className="text-4xl font-bold mb-4">GMD</h1>
        <p className="text-lg text-gray-400 mb-8">
          Сервис родительского контроля и геолокации детей
        </p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Войти
        </Link>
        <p className="mt-8 text-xs text-gray-500">v{APP_VERSION} — MVP</p>
      </main>
    </div>
  );
}
