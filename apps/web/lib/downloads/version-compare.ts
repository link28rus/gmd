// SemVer-сравнение для APK-релизов Перископ.
// Формат version-string из имени файла (см. apps/web/lib/downloads/index.ts):
//   gmd-child-<MAJOR>.<MINOR>.<PATCH>(-<prerelease>)?(+<buildNumber>)?-<abi>.apk
//
// Примеры: 0.39.6, 0.39.6+4055, 0.39.6-rc.1, 0.39.6-rc.1+4050.
//
// Сравнение по SemVer 2.0.0 (https://semver.org/#spec-item-11) с одной поправкой:
// build-metadata (`+N`) Flutter использует как монотонный versionCode,
// поэтому при равной X.Y.Z и одинаковом prerelease сравниваем buildNumber
// численно. Канонический SemVer build metadata игнорирует, но для нашего
// auto-update это даёт правильный «новее» при двух APK с одинаковой X.Y.Z.

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null; // null = stable, "rc.1" = pre-release
  build: number | null; // Flutter +N, null = не указан
  raw: string;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+(\d+))?$/;

export function parseVersion(input: string): ParsedVersion | null {
  const m = input.match(VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ? Number(m[5]) : null,
    raw: input,
  };
}

/**
 * Сравнивает две версии. Возвращает >0 если a новее b, <0 если b новее a, 0 если равны.
 *
 * Порядок: major > minor > patch > prerelease (null > "rc.X") > build (numeric).
 *
 * Stable > prerelease: 1.0.0 > 1.0.0-rc.1.
 * Внутри prerelease — lexicographic (rc.10 < rc.2 — это badluck SemVer, но не наш кейс).
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // prerelease: null (stable) > "rc.X" (prerelease)
  if (a.prerelease === null && b.prerelease !== null) return 1;
  if (a.prerelease !== null && b.prerelease === null) return -1;
  if (a.prerelease !== null && b.prerelease !== null) {
    if (a.prerelease !== b.prerelease) {
      return a.prerelease < b.prerelease ? -1 : 1;
    }
  }
  // build numbers (Flutter versionCode)
  const ab = a.build ?? 0;
  const bb = b.build ?? 0;
  return ab - bb;
}

export function isNewer(candidate: ParsedVersion, baseline: ParsedVersion): boolean {
  return compareVersions(candidate, baseline) > 0;
}
