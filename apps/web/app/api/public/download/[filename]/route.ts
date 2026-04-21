// apps/web/app/api/public/download/[filename]/route.ts
// Публичное скачивание APK — без авторизации. Whitelist-regex на имя файла
// внутри streamDownloadFile предотвращает path-traversal.
import 'server-only';
import type { NextRequest } from 'next/server';
import { streamDownloadFile } from '@/lib/downloads';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ filename: string }> },
): Promise<Response> {
  const { filename } = await ctx.params;
  return streamDownloadFile(filename);
}
