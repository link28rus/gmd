// apps/web/app/api/download/[filename]/route.ts
// Отдаёт APK-файл как stream. Доступ — только для авторизованных (refresh cookie).
// Имя файла валидируется whitelist-regex, чтобы избежать path traversal.
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

// Только релизные APK в известном формате. `..`, `/`, и прочий path-traversal
// отсекаются regex'ом до любого взаимодействия с FS.
const FILENAME_RE =
  /^(?:gmd-(?:child|parent))-\d+\.\d+\.\d+(?:\+\d+)?-(?:arm64-v8a|armeabi-v7a|x86_64|universal)\.apk$/;

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
  if (!FILENAME_RE.test(filename)) {
    return NextResponse.json(
      { error: { code: 'bad_filename', message: 'Invalid filename' } },
      { status: 400 },
    );
  }

  const dir = process.env.DOWNLOAD_DIR ?? '/srv/download';
  const filePath = path.join(dir, filename);

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'File not found' } },
      { status: 404 },
    );
  }
  if (!stat.isFile()) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Not a file' } },
      { status: 404 },
    );
  }

  // fs.createReadStream возвращает Node Readable — конвертируем через Web ReadableStream.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Readable } = require('node:stream') as typeof import('node:stream');
  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as NodeReadableStream<Uint8Array>;

  return new Response(webStream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
