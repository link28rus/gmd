// apps/web/app/api/public/updates/mobile-parent/latest/route.ts
//
// Публичный endpoint для auto-update mobile-parent. Зеркало
// /api/public/updates/mobile-child/latest (см. соседний route.ts), отличие
// только в фильтре по app === 'gmd-parent'.
//
// Mobile-parent Flutter app дёргает на каждом запуске → если version новее
// текущей → скачивает APK через `/api/public/download/<filename>` и запускает
// системный installer.
//
// Без auth (как и /api/public/download) — APK всё равно публично доступен.
//
// Параметры query:
//   abi      — обязательно. arm64-v8a | armeabi-v7a | x86_64 | universal.
//              Из BuildConfig.SUPPORTED_ABIS Android.
//   current  — опционально, для логирования. Формат "0.46.5+20" (X.Y.Z+N).
//
// Response 200:
//   {
//     version: "0.51.0",
//     buildNumber: 2021,
//     filename: "gmd-parent-0.51.0+21-arm64-v8a.apk",
//     url: "https://gmd-online.ru/api/public/download/gmd-parent-0.51.0+21-arm64-v8a.apk",
//     sizeBytes: 21437891,
//     mandatory: false
//   }
//
// Response 204: нет APK для этого abi.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { listDownloadFiles } from '@/lib/downloads';
import { parseVersion, compareVersions } from '@/lib/downloads/version-compare';

// Flutter Gradle plugin при `--split-per-abi` ставит
//   versionCodeOverride = ABI_VERSION[abi] * 1000 + pubspecBuildNumber.
// Backend отдаёт уже нормализованный versionCode, чтобы Flutter-side сравнивал
// PackageInfo.buildNumber с этим числом без преобразований.
const ABI_VERSION: Record<string, number> = {
  'armeabi-v7a': 1,
  'arm64-v8a': 2,
  x86_64: 4,
  universal: 0,
};

const ALLOWED_ABIS = new Set(Object.keys(ABI_VERSION));

export async function GET(req: NextRequest): Promise<NextResponse> {
  const abi = req.nextUrl.searchParams.get('abi');
  if (!abi || !ALLOWED_ABIS.has(abi)) {
    return NextResponse.json(
      {
        error: {
          code: 'bad_abi',
          message: `abi query param required, one of: ${[...ALLOWED_ABIS].join(', ')}`,
        },
      },
      { status: 400 },
    );
  }

  const files = await listDownloadFiles();
  const candidates = files
    .filter((f) => f.app === 'gmd-parent' && f.abi === abi)
    .map((f) => {
      const parsed = parseVersion(f.version);
      return parsed ? { file: f, parsed } : null;
    })
    .filter(
      (
        x,
      ): x is {
        file: (typeof files)[number];
        parsed: NonNullable<ReturnType<typeof parseVersion>>;
      } => x !== null,
    );

  if (candidates.length === 0) {
    return new NextResponse(null, { status: 204 });
  }

  candidates.sort((a, b) => compareVersions(b.parsed, a.parsed));
  const top = candidates[0];

  const fwdHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const fwdProto = req.headers.get('x-forwarded-proto') ?? 'https';
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : req.nextUrl.origin;
  const url = `${origin}/api/public/download/${encodeURIComponent(top.file.filename)}`;

  const versionForUi = `${top.parsed.major}.${top.parsed.minor}.${top.parsed.patch}${top.parsed.prerelease ? `-${top.parsed.prerelease}` : ''}`;

  const pubspecBuild = top.parsed.build ?? 0;
  const effectiveBuild = ABI_VERSION[abi] * 1000 + pubspecBuild;

  return NextResponse.json(
    {
      version: versionForUi,
      buildNumber: effectiveBuild,
      filename: top.file.filename,
      url,
      sizeBytes: top.file.size,
      uploadedAt: top.file.uploadedAt,
      mandatory: false,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
