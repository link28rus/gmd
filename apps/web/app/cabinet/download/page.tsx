// apps/web/app/cabinet/download/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import DownloadClient from './download-client';

export default async function DownloadPage(): Promise<ReactElement> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) redirect('/login');
  return <DownloadClient />;
}
