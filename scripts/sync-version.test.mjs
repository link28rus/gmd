import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync } from './sync-version.mjs';

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
