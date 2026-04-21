// apps/web/app/api/download/route.ts
// Листинг APK-файлов в /srv/download. Доступ — только для авторизованных (refresh cookie).
// Для публичного листинга см. /api/public/download.
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { listDownloadFiles } from '@/lib/downloads';

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Login required' } },
      { status: 401 },
    );
  }
  const files = await listDownloadFiles();
  return NextResponse.json({ files });
}
