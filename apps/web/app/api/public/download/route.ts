// apps/web/app/api/public/download/route.ts
// Публичный листинг APK — доступен без авторизации. Нужен на лендинге, чтобы
// неавторизованный пользователь мог скачать приложение ребёнка и установить
// на его телефон до регистрации.
import 'server-only';
import { NextResponse } from 'next/server';
import { listDownloadFiles } from '@/lib/downloads';

export async function GET(): Promise<NextResponse> {
  const files = await listDownloadFiles();
  return NextResponse.json({ files });
}
