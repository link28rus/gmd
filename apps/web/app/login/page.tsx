import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { listDownloadFiles, type DownloadFile } from '@/lib/downloads';
import { REFRESH_UNAVAILABLE_COOKIE } from '@/lib/auth/session-cookie';
import LoginClient, { type LoginApk } from './login-client';

// Последняя версия приложения: arm64-v8a подходит почти всем телефонам,
// остальные ABI — на странице /download.
function latestApk(files: DownloadFile[], app: DownloadFile['app']): LoginApk | null {
  const byApp = files.filter((f) => f.app === app);
  const version = byApp[0]?.version; // listDownloadFiles сортирует app → version desc
  const latest = byApp.filter((f) => f.version === version);
  const file = latest.find((f) => f.abi === 'arm64-v8a') ?? latest[0];
  return file ? { filename: file.filename, version: file.version, size: file.size } : null;
}

export default async function LoginPage(): Promise<ReactElement> {
  // Если refresh-cookie уже есть — пользователь залогинен; не показываем форму,
  // а сразу пускаем в кабинет. Симметрично /cabinet → /login при отсутствии cookie.
  // Исключение — кабинет только что не смог обновить сессию из-за сбоя сервера
  // (см. REFRESH_UNAVAILABLE_COOKIE): редирект вернул бы в кабинет по кругу.
  const cookieStore = await cookies();
  const serverUnavailable = cookieStore.get(REFRESH_UNAVAILABLE_COOKIE)?.value === '1';
  if (cookieStore.get('gmd_refresh')?.value && !serverUnavailable) {
    redirect('/cabinet');
  }
  const files = await listDownloadFiles();
  return (
    <LoginClient
      apps={{ parent: latestApk(files, 'gmd-parent'), child: latestApk(files, 'gmd-child') }}
      serverUnavailable={serverUnavailable}
    />
  );
}
