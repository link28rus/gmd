import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync, check } from './sync-version.mjs';

function makeFakeRepo(version = '1.2.3') {
  const root = mkdtempSync(join(tmpdir(), 'gmd-sync-'));
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  mkdirSync(join(root, 'apps/backend'), { recursive: true });
  mkdirSync(join(root, 'apps/mobile-child'), { recursive: true });
  mkdirSync(join(root, 'apps/mobile-parent'), { recursive: true });

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'gmd', version }, null, 2) + '\n'
  );
  writeFileSync(
    join(root, 'apps/web/package.json'),
    JSON.stringify({ name: '@gmd/web', version: '0.0.0' }, null, 2) + '\n'
  );
  writeFileSync(
    join(root, 'apps/backend/package.json'),
    JSON.stringify({ name: '@gmd/backend', version: '0.0.0' }, null, 2) + '\n'
  );
  writeFileSync(
    join(root, 'apps/mobile-child/pubspec.yaml'),
    'name: gmd_child\nversion: 0.0.0+5\n'
  );
  writeFileSync(
    join(root, 'apps/mobile-parent/pubspec.yaml'),
    'name: gmd_parent\nversion: 0.0.0+1\n'
  );
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## v${version} — 2026-04-21\n\n### Исправления\n\n- test entry\n`
  );

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('sync распространяет версию в apps/*/package.json', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    const web = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
    const backend = JSON.parse(readFileSync(join(root, 'apps/backend/package.json'), 'utf8'));
    assert.equal(web.version, '1.2.3');
    assert.equal(backend.version, '1.2.3');
  } finally {
    cleanup();
  }
});

test('sync обновляет X.Y.Z в pubspec, сохраняет build number +N', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    const child = readFileSync(join(root, 'apps/mobile-child/pubspec.yaml'), 'utf8');
    const parent = readFileSync(join(root, 'apps/mobile-parent/pubspec.yaml'), 'utf8');
    assert.match(child, /^version:\s*1\.2\.3\+5$/m);
    assert.match(parent, /^version:\s*1\.2\.3\+1$/m);
  } finally {
    cleanup();
  }
});

test('sync оставляет pubspec без +N неизменным по части X.Y.Z', () => {
  const { root, cleanup } = makeFakeRepo('2.0.0');
  try {
    writeFileSync(
      join(root, 'apps/mobile-child/pubspec.yaml'),
      'name: gmd_child\nversion: 0.0.0\n'
    );
    sync(root);
    const child = readFileSync(join(root, 'apps/mobile-child/pubspec.yaml'), 'utf8');
    assert.match(child, /^version:\s*2\.0\.0$/m);
  } finally {
    cleanup();
  }
});

test('sync идемпотентен — повторный запуск не меняет файлы', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    const webSnap = readFileSync(join(root, 'apps/web/package.json'), 'utf8');
    const childSnap = readFileSync(join(root, 'apps/mobile-child/pubspec.yaml'), 'utf8');
    sync(root);
    assert.equal(readFileSync(join(root, 'apps/web/package.json'), 'utf8'), webSnap);
    assert.equal(readFileSync(join(root, 'apps/mobile-child/pubspec.yaml'), 'utf8'), childSnap);
  } finally {
    cleanup();
  }
});

test('check на синхронном репо возвращает пустой массив ошибок', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    assert.deepEqual(check(root), []);
  } finally {
    cleanup();
  }
});

test('check ловит расхождение apps/web/package.json', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    writeFileSync(
      join(root, 'apps/web/package.json'),
      JSON.stringify({ name: '@gmd/web', version: '9.9.9' }, null, 2) + '\n'
    );
    const errors = check(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/web\/package\.json/);
    assert.match(errors[0], /1\.2\.3/);
    assert.match(errors[0], /9\.9\.9/);
  } finally {
    cleanup();
  }
});

test('check ловит расхождение X.Y.Z в pubspec (build number игнорируется)', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    writeFileSync(
      join(root, 'apps/mobile-child/pubspec.yaml'),
      'name: gmd_child\nversion: 0.9.9+5\n'
    );
    const errors = check(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/mobile-child\/pubspec\.yaml/);
    assert.match(errors[0], /1\.2\.3/);
    assert.match(errors[0], /0\.9\.9/);
  } finally {
    cleanup();
  }
});

test('check игнорирует разные build number в pubspec', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    writeFileSync(
      join(root, 'apps/mobile-child/pubspec.yaml'),
      'name: gmd_child\nversion: 1.2.3+999\n'
    );
    assert.deepEqual(check(root), []);
  } finally {
    cleanup();
  }
});

test('check ловит расхождение верхней записи CHANGELOG', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    writeFileSync(
      join(root, 'CHANGELOG.md'),
      `# Changelog\n\n## v0.9.9 — 2026-04-01\n\n- old\n`
    );
    const errors = check(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /CHANGELOG\.md/);
    assert.match(errors[0], /0\.9\.9/);
    assert.match(errors[0], /1\.2\.3/);
  } finally {
    cleanup();
  }
});

test('check пропускает CHANGELOG без ни одной записи', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\nНет записей.\n');
    const errors = check(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /CHANGELOG\.md/);
    assert.match(errors[0], /no version entry/i);
  } finally {
    cleanup();
  }
});

test('check падает, если apps/web/lib/version.ts вернулся', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    mkdirSync(join(root, 'apps/web/lib'), { recursive: true });
    writeFileSync(
      join(root, 'apps/web/lib/version.ts'),
      "export const APP_VERSION = '1.2.3';\n"
    );
    const errors = check(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/web\/lib\/version\.ts/);
    assert.match(errors[0], /source of truth/i);
  } finally {
    cleanup();
  }
});
