// apps/web/app/api/download/route.ts
// Листинг APK-файлов в /srv/download (read-only volume из /opt/gmd/download).
// Доступ — только для авторизованных (refresh cookie).
import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

interface DownloadFile {
  filename: string;
  app: 'gmd-child' | 'gmd-parent';
  version: string;
  abi: string;
  size: number;
  uploadedAt: string;
}

// gmd-child-0.14.0-arm64-v8a.apk → {app:'gmd-child', version:'0.14.0', abi:'arm64-v8a'}
const FILENAME_RE =
  /^(?<app>gmd-(?:child|parent))-(?<version>\d+\.\d+\.\d+(?:\+\d+)?)-(?<abi>arm64-v8a|armeabi-v7a|x86_64|universal)\.apk$/;

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  if (!cookieStore.get('gmd_refresh')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Login required' } },
      { status: 401 },
    );
  }

  const dir = process.env.DOWNLOAD_DIR ?? '/srv/download';
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return NextResponse.json({ files: [] });
  }

  const files: DownloadFile[] = [];
  for (const name of entries) {
    const m = name.match(FILENAME_RE);
    if (!m?.groups) continue;
    try {
      const stat = await fs.stat(path.join(dir, name));
      if (!stat.isFile()) continue;
      files.push({
        filename: name,
        app: m.groups.app as DownloadFile['app'],
        version: m.groups.version,
        abi: m.groups.abi,
        size: stat.size,
        uploadedAt: stat.mtime.toISOString(),
      });
    } catch {
      // skip unreadable entries
    }
  }

  // Сортируем: app → версия (новее сверху) → abi
  files.sort((a, b) => {
    if (a.app !== b.app) return a.app.localeCompare(b.app);
    // Простое сравнение по version string (без парсинга semver) — достаточно для сортировки последних релизов
    if (a.version !== b.version) return b.version.localeCompare(a.version);
    return a.abi.localeCompare(b.abi);
  });

  return NextResponse.json({ files });
}
