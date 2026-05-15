// apps/web/app/api/public/updates/mobile-child/latest/route.ts
//
// Публичный endpoint для auto-update mobile-child.
// Mobile-child Flutter app дёргает на каждом запуске → если version новее
// текущей → скачивает APK через `/api/public/download/<filename>` и запускает
// системный installer.
//
// Без auth (как и /api/public/download) — APK всё равно публично доступен,
// плюс mobile-child перед claim'ом не имеет JWT.
//
// Параметры query:
//   abi      — обязательно. arm64-v8a | armeabi-v7a | x86_64 | universal.
//              Из BuildConfig.SUPPORTED_ABIS Android.
//   current  — опционально, для логирования. Формат "0.39.6+4055" (X.Y.Z+N).
//
// Response 200:
//   {
//     version: "0.39.7",
//     buildNumber: 4060,
//     filename: "gmd-child-0.39.7+4060-arm64-v8a.apk",
//     url: "https://gmd-online.ru/api/public/download/gmd-child-0.39.7+4060-arm64-v8a.apk",
//     sizeBytes: 28491233,
//     mandatory: false
//   }
//
// Response 204: нет APK для этого abi (например, debug-сборка без релиза).
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { listDownloadFiles } from '@/lib/downloads';
import { parseVersion, compareVersions } from '@/lib/downloads/version-compare';

// Flutter Gradle plugin при `--split-per-abi` делает
//   versionCodeOverride = ABI_VERSION[abi] * 1000 + pubspecBuildNumber.
// Источник: flutter_tools/gradle/src/main/kotlin/FlutterPluginConstants.kt
// (`ABI_VERSION` map). Из-за этого PackageInfo.buildNumber на устройстве
// отличается от `+N` в имени APK. Чтобы mobile-child корректно сравнивал
// текущий build с latest — отдаём УЖЕ нормализованный versionCode.
const ABI_VERSION: Record<string, number> = {
  'armeabi-v7a': 1,
  'arm64-v8a': 2,
  x86_64: 4,
  universal: 0, // не в split-per-abi → нет offset
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
    .filter((f) => f.app === 'gmd-child' && f.abi === abi)
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
    // 204 — корректный ответ «обновлений нет», mobile-child не показывает кнопку.
    return new NextResponse(null, { status: 204 });
  }

  // Сортируем descending — берём топ.
  candidates.sort((a, b) => compareVersions(b.parsed, a.parsed));
  const top = candidates[0];

  // Абсолютный URL собираем по X-Forwarded-* (за Caddy reverse-proxy
  // req.nextUrl.origin даёт `0.0.0.0:3000` — внутренний bind контейнера).
  // Если заголовков нет (локальный fetch без прокси) — fallback на origin.
  const fwdHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const fwdProto = req.headers.get('x-forwarded-proto') ?? 'https';
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : req.nextUrl.origin;
  const url = `${origin}/api/public/download/${encodeURIComponent(top.file.filename)}`;

  // Для UI показываем X.Y.Z (без +N), build отдельным полем.
  const versionForUi = `${top.parsed.major}.${top.parsed.minor}.${top.parsed.patch}${top.parsed.prerelease ? `-${top.parsed.prerelease}` : ''}`;

  // Нормализуем build под Flutter ABI offset (см. ABI_VERSION выше).
  // mobile-child получает PackageInfo.buildNumber == ABI_VERSION*1000+pubspecBuild,
  // backend хранит только pubspecBuild в имени файла.
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
        // Эндпоинт лёгкий, но кэшировать на CDN не стоит — нужно реагировать
        // на новые APK сразу после deploy.
        'Cache-Control': 'no-store',
      },
    },
  );
}
