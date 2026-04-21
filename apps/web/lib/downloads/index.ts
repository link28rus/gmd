import 'server-only';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

export interface DownloadFile {
  filename: string;
  app: 'gmd-child' | 'gmd-parent';
  version: string;
  abi: string;
  size: number;
  uploadedAt: string;
}

// gmd-child-0.14.0-arm64-v8a.apk → {app, version, abi}
const FILENAME_RE =
  /^(?<app>gmd-(?:child|parent))-(?<version>\d+\.\d+\.\d+(?:\+\d+)?)-(?<abi>arm64-v8a|armeabi-v7a|x86_64|universal)\.apk$/;

// Только релизные APK — те же ABI, строго, без path-traversal.
const STRICT_FILENAME_RE =
  /^(?:gmd-(?:child|parent))-\d+\.\d+\.\d+(?:\+\d+)?-(?:arm64-v8a|armeabi-v7a|x86_64|universal)\.apk$/;

function downloadDir(): string {
  return process.env.DOWNLOAD_DIR ?? '/srv/download';
}

export async function listDownloadFiles(): Promise<DownloadFile[]> {
  const dir = downloadDir();
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }

  const files: DownloadFile[] = [];
  for (const name of entries) {
    const m = name.match(FILENAME_RE);
    if (!m?.groups) continue;
    try {
      const stat = await fsp.stat(path.join(dir, name));
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

  // Сортируем: app → версия (новее сверху) → abi.
  files.sort((a, b) => {
    if (a.app !== b.app) return a.app.localeCompare(b.app);
    // Простое сравнение по version-string (без parsing) — достаточно для последних релизов.
    if (a.version !== b.version) return b.version.localeCompare(a.version);
    return a.abi.localeCompare(b.abi);
  });

  return files;
}

export async function streamDownloadFile(filename: string): Promise<Response> {
  if (!STRICT_FILENAME_RE.test(filename)) {
    return NextResponse.json(
      { error: { code: 'bad_filename', message: 'Invalid filename' } },
      { status: 400 },
    );
  }

  const dir = downloadDir();
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

  // fs.createReadStream → Node Readable → Web ReadableStream.
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
