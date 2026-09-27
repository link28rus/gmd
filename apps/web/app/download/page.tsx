// apps/web/app/download/page.tsx
// Публичная страница скачивания APK — доступна без авторизации. Ссылка на
// неё показана в шапке лендинга, чтобы родитель мог скачать приложение
// ребёнка и установить его до регистрации / в отсутствие интернета.
import Link from 'next/link';
import type { ReactElement } from 'react';
import DownloadPublicClient from './download-public-client';

export default function PublicDownloadPage(): ReactElement {
  return (
    <main className="min-h-screen bg-[#050a15] text-slate-100">
      <header className="border-b border-slate-800 bg-[#050a15]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold text-slate-100">
            Перископ
          </Link>
          <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white">
            Войти
          </Link>
        </div>
      </header>
      <DownloadPublicClient />
    </main>
  );
}
