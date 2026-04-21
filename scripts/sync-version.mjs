import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = {
  packageJsons: ['apps/web/package.json', 'apps/backend/package.json'],
  pubspecs: ['apps/mobile-child/pubspec.yaml', 'apps/mobile-parent/pubspec.yaml'],
};

export function getRootVersion(rootDir) {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  return pkg.version;
}

export function writePackageJsonVersion(filePath, version) {
  const raw = readFileSync(filePath, 'utf8');
  const updated = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  writeFileSync(filePath, updated);
}

export function writePubspecVersion(filePath, newSemver) {
  const raw = readFileSync(filePath, 'utf8');
  const updated = raw.replace(
    /^(version:\s*)(\d+\.\d+\.\d+)(\+\d+)?\s*$/m,
    (_, prefix, _old, build) => `${prefix}${newSemver}${build ?? ''}`
  );
  writeFileSync(filePath, updated);
}

export function sync(rootDir) {
  const v = getRootVersion(rootDir);
  for (const rel of TARGETS.packageJsons) {
    writePackageJsonVersion(join(rootDir, rel), v);
  }
  for (const rel of TARGETS.pubspecs) {
    writePubspecVersion(join(rootDir, rel), v);
  }
}
