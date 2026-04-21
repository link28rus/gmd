// apps/web/app/api/download/[filename]/route.ts
// Скачивание APK — только для авторизованных. Публичный вариант см. /api/public/download/[filename].
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { streamDownloadFile } from '@/lib/downloads';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ filename: string }> },
): Promise<Response> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Login required' } },
      { status: 401 },
    );
  }
  const { filename } = await ctx.params;
  return streamDownloadFile(filename);
}
