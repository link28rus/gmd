import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGETS = {
  packageJsons: ['apps/web/package.json', 'apps/backend/package.json'],
  pubspecs: ['apps/mobile-child/pubspec.yaml', 'apps/mobile-parent/pubspec.yaml'],
};

const CHANGELOG_PATH = 'CHANGELOG.md';
const STALE_VERSION_TS = 'apps/web/lib/version.ts';

export function getRootVersion(rootDir) {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  return pkg.version;
}

export function readPackageJsonVersion(filePath) {
  const pkg = JSON.parse(readFileSync(filePath, 'utf8'));
  return pkg.version;
}

export function writePackageJsonVersion(filePath, version) {
  const raw = readFileSync(filePath, 'utf8');
  const updated = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  writeFileSync(filePath, updated);
}

export function readPubspecVersion(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const match = raw.match(/^version:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

export function writePubspecVersion(filePath, newSemver) {
  const raw = readFileSync(filePath, 'utf8');
  const updated = raw.replace(
    /^(version:[ \t]*)(\d+\.\d+\.\d+)(\+\d+)?[ \t]*$/m,
    (_, prefix, _old, build) => `${prefix}${newSemver}${build ?? ''}`
  );
  writeFileSync(filePath, updated);
}

export function readChangelogTopVersion(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  // SemVer 2.0: MAJOR.MINOR.PATCH с опциональным prerelease (-rc.1, -beta.0 и т.п.).
  // Captures всё включая prerelease, чтобы 0.35.0-rc.1 в CHANGELOG не путался с 0.35.0.
  const match = raw.match(/^## v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/m);
  return match ? match[1] : null;
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

export function check(rootDir) {
  const v = getRootVersion(rootDir);
  const errors = [];

  for (const rel of TARGETS.packageJsons) {
    const got = readPackageJsonVersion(join(rootDir, rel));
    if (got !== v) {
      errors.push(`${rel}: expected ${v}, got ${got}`);
    }
  }

  for (const rel of TARGETS.pubspecs) {
    const got = readPubspecVersion(join(rootDir, rel));
    const gotSemver = got ? got.split('+')[0] : null;
    if (gotSemver !== v) {
      errors.push(`${rel}: expected ${v}+N, got ${got}`);
    }
  }

  const changelogTop = readChangelogTopVersion(join(rootDir, CHANGELOG_PATH));
  if (changelogTop === null) {
    errors.push(`${CHANGELOG_PATH}: no version entry (## vX.Y.Z) found`);
  } else if (changelogTop !== v) {
    errors.push(`${CHANGELOG_PATH}: top entry ${changelogTop}, root version ${v}`);
  }

  if (existsSync(join(rootDir, STALE_VERSION_TS))) {
    errors.push(
      `${STALE_VERSION_TS} exists — delete it, root package.json is source of truth`
    );
  }

  return errors;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const cmd = process.argv[2];
  const rootDir = process.cwd();

  if (cmd === 'sync') {
    sync(rootDir);
    console.log(`✓ Version ${getRootVersion(rootDir)} distributed.`);
  } else if (cmd === 'check') {
    const errors = check(rootDir);
    if (errors.length) {
      console.error(`✗ Version mismatch (root ${getRootVersion(rootDir)}):`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(`✓ Version ${getRootVersion(rootDir)} consistent across monorepo.`);
  } else {
    console.error('Usage: node scripts/sync-version.mjs [sync|check]');
    process.exit(2);
  }
}
