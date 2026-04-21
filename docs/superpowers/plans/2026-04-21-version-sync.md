# Version Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать рассинхрон версий в монорепо, сделав корневой `package.json` единственным источником правды для продуктовой версии GMD, с автоматической синхронизацией и CI-валидацией.

**Architecture:** Node-скрипт `scripts/sync-version.mjs` с двумя командами (`sync` / `check`) распространяет `root package.json#version` в apps/\*/package.json и X.Y.Z часть в mobile pubspec'ах. Flutter build numbers (+N) инкрементируются независимо. Pre-commit hook + CI workflow валидируют согласованность. `apps/web/lib/version.ts` удаляется — UI читает версию из package.json.

**Tech Stack:** Node 22 (ESM, встроенный `node --test`), TypeScript, Next.js 15, pnpm workspaces, husky, GitHub Actions.

**Related spec:** [docs/superpowers/specs/2026-04-21-version-sync-design.md](../specs/2026-04-21-version-sync-design.md)

---

## Файловая структура

**Создаются:**

- `scripts/sync-version.mjs` — основной скрипт (чистые функции + CLI)
- `scripts/sync-version.test.mjs` — тесты на `node --test`
- `.github/workflows/version-check.yml` — CI workflow

**Модифицируются:**

- `package.json` (root) — версия `0.11.0` → `0.17.1`, добавляются npm-скрипты `version:sync` / `version:check`
- `apps/web/package.json` — версия `0.11.0` → `0.17.1`
- `apps/backend/package.json` — версия `0.11.0` → `0.17.1`
- `apps/mobile-parent/pubspec.yaml` — `1.0.0+1` → `0.17.1+1`
- `apps/mobile-child/pubspec.yaml` — `0.15.3+11` → `0.17.1+11` (build number сохраняется)
- `apps/web/components/cabinet/cabinet-header.tsx` — импорт версии из `package.json`
- `apps/web/next.config.ts` — проброс `APP_VERSION` в env для Sentry
- `.husky/pre-commit` — добавляется `pnpm version:check`
- `CLAUDE.md` — подраздел про источник правды версии

**Удаляется:**

- `apps/web/lib/version.ts`

---

## Предусловие: рабочее окружение

- [ ] **Step 0.1: Убедиться, что pnpm доступен в текущей сессии**

Run:
```bash
pnpm --version
```
Expected: печатает номер версии (например, `9.15.0`). Если `command not found` — перед выполнением плана установить pnpm (`corepack enable pnpm` от админа, либо `npm i -g pnpm@9.15.0`).

- [ ] **Step 0.2: Установить зависимости в worktree**

Run (из корня worktree):
```bash
pnpm install --frozen-lockfile
```
Expected: `node_modules` создан, husky установлен, lockfile не изменён.

---

## Task 1: Скрипт sync-version — структура и happy path sync (TDD)

**Files:**

- Create: `scripts/sync-version.mjs`
- Create: `scripts/sync-version.test.mjs`

Скрипт пишется на чистом Node 22 ESM без зависимостей. Функции принимают `rootDir` параметром — это делает их тестируемыми во временном каталоге, без моков файловой системы.

- [ ] **Step 1.1: Написать падающий тест «sync распространяет версию в apps/\*/package.json»**

Создать `scripts/sync-version.test.mjs`:

```js
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
```

- [ ] **Step 1.2: Запустить тест, убедиться что он падает**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: FAIL с `Cannot find module './sync-version.mjs'` (файла ещё нет).

- [ ] **Step 1.3: Написать минимальную реализацию `sync`**

Создать `scripts/sync-version.mjs`:

```js
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

export function sync(rootDir) {
  const v = getRootVersion(rootDir);
  for (const rel of TARGETS.packageJsons) {
    writePackageJsonVersion(join(rootDir, rel), v);
  }
}
```

- [ ] **Step 1.4: Запустить тест, убедиться что он проходит**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: `# pass 1` / `# fail 0`.

- [ ] **Step 1.5: Коммит**

```bash
git add scripts/sync-version.mjs scripts/sync-version.test.mjs
git commit -m "feat(scripts): sync-version — каркас + sync для package.json"
```

---

## Task 2: sync для Flutter pubspec — сохранить build number

**Files:**

- Modify: `scripts/sync-version.mjs`
- Modify: `scripts/sync-version.test.mjs`

- [ ] **Step 2.1: Написать падающий тест «sync обновляет X.Y.Z в pubspec, сохраняет +N»**

Добавить в `scripts/sync-version.test.mjs`:

```js
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
```

- [ ] **Step 2.2: Запустить тесты, убедиться что падают**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: FAIL, два новых теста падают (`sync` не обновляет pubspec).

- [ ] **Step 2.3: Добавить `writePubspecVersion` и подключить в `sync`**

В `scripts/sync-version.mjs` добавить функцию и расширить `sync`:

```js
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
```

- [ ] **Step 2.4: Запустить тесты, убедиться что проходят**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: `# pass 3` / `# fail 0`.

- [ ] **Step 2.5: Коммит**

```bash
git add scripts/sync-version.mjs scripts/sync-version.test.mjs
git commit -m "feat(scripts): sync-version — поддержка Flutter pubspec, +N сохраняется"
```

---

## Task 3: sync идемпотентен

**Files:**

- Modify: `scripts/sync-version.test.mjs`

- [ ] **Step 3.1: Написать тест «двойной запуск sync не меняет файлы»**

Добавить в `scripts/sync-version.test.mjs`:

```js
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
```

- [ ] **Step 3.2: Запустить тесты**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: PASS (реализация уже идемпотентна — regex заменяет уже-правильную версию на ту же).

- [ ] **Step 3.3: Коммит**

```bash
git add scripts/sync-version.test.mjs
git commit -m "test(scripts): sync-version идемпотентен"
```

---

## Task 4: check — валидация package.json (TDD)

**Files:**

- Modify: `scripts/sync-version.mjs`
- Modify: `scripts/sync-version.test.mjs`

- [ ] **Step 4.1: Написать падающий тест «check на синхронном репо — нет ошибок»**

Добавить импорт `check` в начало файла тестов:

```js
import { sync, check } from './sync-version.mjs';
```

Добавить тесты:

```js
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
```

- [ ] **Step 4.2: Запустить тесты, убедиться что падают**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: FAIL (функция `check` не экспортируется).

- [ ] **Step 4.3: Реализовать `check` + вспомогательные функции чтения**

Добавить в `scripts/sync-version.mjs`:

```js
export function readPackageJsonVersion(filePath) {
  const pkg = JSON.parse(readFileSync(filePath, 'utf8'));
  return pkg.version;
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

  return errors;
}
```

- [ ] **Step 4.4: Запустить тесты**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: PASS для двух новых тестов.

- [ ] **Step 4.5: Коммит**

```bash
git add scripts/sync-version.mjs scripts/sync-version.test.mjs
git commit -m "feat(scripts): sync-version — check для package.json"
```

---

## Task 5: check — валидация pubspec X.Y.Z

**Files:**

- Modify: `scripts/sync-version.mjs`
- Modify: `scripts/sync-version.test.mjs`

- [ ] **Step 5.1: Написать падающий тест**

```js
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

test('check игнорирует разные build number', () => {
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
```

- [ ] **Step 5.2: Запустить тесты, убедиться что падают**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: FAIL (`check` не проверяет pubspec).

- [ ] **Step 5.3: Добавить чтение pubspec и проверку в `check`**

```js
export function readPubspecVersion(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const match = raw.match(/^version:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
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

  return errors;
}
```

- [ ] **Step 5.4: Запустить тесты**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: PASS.

- [ ] **Step 5.5: Коммит**

```bash
git add scripts/sync-version.mjs scripts/sync-version.test.mjs
git commit -m "feat(scripts): sync-version — check для Flutter pubspec"
```

---

## Task 6: check — CHANGELOG.md верхняя запись

**Files:**

- Modify: `scripts/sync-version.mjs`
- Modify: `scripts/sync-version.test.mjs`

- [ ] **Step 6.1: Написать падающий тест**

```js
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

test('check пропускает CHANGELOG если нет ни одной ## vX.Y.Z записи', () => {
  // Пустой changelog — edge case, ошибка должна быть, но отдельная
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
```

- [ ] **Step 6.2: Запустить тесты, убедиться что падают**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: FAIL.

- [ ] **Step 6.3: Реализация**

Добавить в `scripts/sync-version.mjs`:

```js
export function readChangelogTopVersion(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const match = raw.match(/^## v(\d+\.\d+\.\d+)/m);
  return match ? match[1] : null;
}
```

Расширить `check`:

```js
  const changelogPath = join(rootDir, 'CHANGELOG.md');
  const changelogTop = readChangelogTopVersion(changelogPath);
  if (changelogTop === null) {
    errors.push(`CHANGELOG.md: no version entry (## vX.Y.Z) found`);
  } else if (changelogTop !== v) {
    errors.push(`CHANGELOG.md: top entry ${changelogTop}, root version ${v}`);
  }
```

- [ ] **Step 6.4: Запустить тесты**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: PASS.

- [ ] **Step 6.5: Коммит**

```bash
git add scripts/sync-version.mjs scripts/sync-version.test.mjs
git commit -m "feat(scripts): sync-version — check для CHANGELOG верхней записи"
```

---

## Task 7: check — защита от возврата version.ts

**Files:**

- Modify: `scripts/sync-version.mjs`
- Modify: `scripts/sync-version.test.mjs`

- [ ] **Step 7.1: Написать падающий тест**

```js
test('check падает, если apps/web/lib/version.ts вернулся', () => {
  const { root, cleanup } = makeFakeRepo('1.2.3');
  try {
    sync(root);
    mkdirSync(join(root, 'apps/web/lib'), { recursive: true });
    writeFileSync(join(root, 'apps/web/lib/version.ts'), "export const APP_VERSION = '1.2.3';\n");
    const errors = check(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /apps\/web\/lib\/version\.ts/);
    assert.match(errors[0], /source of truth/i);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 7.2: Запустить тест, убедиться что падает**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: FAIL.

- [ ] **Step 7.3: Реализация**

Добавить импорт:

```js
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
```

Расширить `check`:

```js
  const staleVersionTs = join(rootDir, 'apps/web/lib/version.ts');
  if (existsSync(staleVersionTs)) {
    errors.push(
      `apps/web/lib/version.ts exists — delete it, root package.json is source of truth`
    );
  }
```

- [ ] **Step 7.4: Запустить тесты**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: PASS.

- [ ] **Step 7.5: Коммит**

```bash
git add scripts/sync-version.mjs scripts/sync-version.test.mjs
git commit -m "feat(scripts): sync-version — check блокирует возврат lib/version.ts"
```

---

## Task 8: CLI entry и npm-скрипты

**Files:**

- Modify: `scripts/sync-version.mjs`
- Modify: `package.json` (root)

- [ ] **Step 8.1: Добавить CLI entry-point в `scripts/sync-version.mjs`**

В конец файла:

```js
import { pathToFileURL } from 'node:url';

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
```

Добавить импорт в начало файла:

```js
import { pathToFileURL } from 'node:url';
```

- [ ] **Step 8.2: Добавить npm-скрипты в корневой package.json**

В `package.json` в секции `"scripts"` добавить:

```json
    "version:sync": "node scripts/sync-version.mjs sync",
    "version:check": "node scripts/sync-version.mjs check",
```

- [ ] **Step 8.3: Проверить CLI на тестовом запуске в реальном репо**

Run (в корне worktree):
```bash
pnpm version:check
```
Expected: **FAIL** — 5+ ошибок рассинхрона (web/package.json=0.11.0, backend=0.11.0, mobile-child=0.15.3+11, mobile-parent=1.0.0+1, CHANGELOG top=0.17.1, lib/version.ts existing). Это ожидаемо — мы ещё не синхронизировали.

Записать вывод для проверки Task 9.

- [ ] **Step 8.4: Коммит**

```bash
git add scripts/sync-version.mjs package.json
git commit -m "feat(scripts): sync-version CLI + npm-скрипты version:sync/check"
```

---

## Task 9: Первая синхронизация — bump root до 0.17.1 и распространение

**Files:**

- Modify: `package.json` (root) — `0.11.0` → `0.17.1`
- Modify: `apps/web/package.json` — через sync
- Modify: `apps/backend/package.json` — через sync
- Modify: `apps/mobile-child/pubspec.yaml` — через sync
- Modify: `apps/mobile-parent/pubspec.yaml` — через sync

- [ ] **Step 9.1: Bump корневой `package.json` до `0.17.1`**

Открыть [package.json](package.json), изменить строку 3:

```diff
-  "version": "0.11.0",
+  "version": "0.17.1",
```

- [ ] **Step 9.2: Запустить sync**

Run:
```bash
pnpm version:sync
```
Expected: `✓ Version 0.17.1 distributed.`

- [ ] **Step 9.3: Проверить diff**

Run:
```bash
git diff package.json apps/web/package.json apps/backend/package.json apps/mobile-child/pubspec.yaml apps/mobile-parent/pubspec.yaml
```
Expected:
- `package.json`: `0.11.0` → `0.17.1`
- `apps/web/package.json`: `0.11.0` → `0.17.1`
- `apps/backend/package.json`: `0.11.0` → `0.17.1`
- `apps/mobile-child/pubspec.yaml`: `0.15.3+11` → `0.17.1+11` (build number сохранён)
- `apps/mobile-parent/pubspec.yaml`: `1.0.0+1` → `0.17.1+1`

- [ ] **Step 9.4: Запустить check — должен почти пройти**

Run:
```bash
pnpm version:check
```
Expected: **FAIL** с одной ошибкой: `apps/web/lib/version.ts exists`. Остальные ошибки ушли.

- [ ] **Step 9.5: Коммит (пока без удаления version.ts — это в следующей задаче)**

```bash
git add package.json apps/web/package.json apps/backend/package.json apps/mobile-child/pubspec.yaml apps/mobile-parent/pubspec.yaml
git commit -m "chore: синхронизация версий монорепо до 0.17.1"
```

---

## Task 10: Переключение web UI на package.json + удаление version.ts

**Files:**

- Modify: `apps/web/components/cabinet/cabinet-header.tsx`
- Modify: `apps/web/next.config.ts`
- Delete: `apps/web/lib/version.ts`

- [ ] **Step 10.1: Заменить источник APP_VERSION в cabinet-header**

Открыть [apps/web/components/cabinet/cabinet-header.tsx:9](apps/web/components/cabinet/cabinet-header.tsx):

```diff
-import { APP_VERSION } from '@/lib/version';
+import pkg from '@/package.json';
+
+const APP_VERSION = pkg.version;
```

(Остальные использования `{APP_VERSION}` в строках 58 и 113 остаются без изменений — константа та же.)

- [ ] **Step 10.2: Прокинуть APP_VERSION в env через next.config.ts**

Открыть [apps/web/next.config.ts](apps/web/next.config.ts), заменить:

```ts
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import pkg from './package.json' with { type: 'json' };

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    APP_VERSION: pkg.version,
  },
  // standalone нужен только для prod-docker (multi-stage build).
  // Локально на Windows он падает с EPERM при создании symlinks (без admin-прав).
  ...(process.env.NEXT_STANDALONE === 'true' ? { output: 'standalone' } : {}),
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
  disableLogger: true,
  tunnelRoute: '/api/sentry-tunnel',
});
```

Примечание: `import ... with { type: 'json' }` — стандартный синтаксис ESM Node 22. Если `with` не поддерживается в tsconfig (`assert` был старый синтаксис) — альтернатива через `require` в Next.js config (Next допускает CJS):

```ts
const pkg = require('./package.json') as { version: string };
```

(При несовместимости — проверяем build + `pnpm --filter @gmd/web typecheck`.)

- [ ] **Step 10.3: Удалить `apps/web/lib/version.ts`**

Run:
```bash
rm apps/web/lib/version.ts
```

- [ ] **Step 10.4: Убедиться, что больше нигде `@/lib/version` не импортируется**

Run (используя dedicated grep через tooling — тут в командной форме для плана):
```bash
grep -rn "from '@/lib/version'" apps/web --include='*.ts' --include='*.tsx'
grep -rn 'from "@/lib/version"' apps/web --include='*.ts' --include='*.tsx'
```
Expected: no matches. Если есть — переписать их так же, как в Step 10.1.

- [ ] **Step 10.5: Typecheck web**

Run:
```bash
pnpm --filter @gmd/web typecheck
```
Expected: no errors.

- [ ] **Step 10.6: Сборка web — убедиться, что import JSON реально работает**

Run:
```bash
pnpm --filter @gmd/web build
```
Expected: build успешен, no errors. Если падает на `import pkg from './package.json' with { type: 'json' }` — применить fallback через `require`, повторить build.

- [ ] **Step 10.7: Визуальная проверка через dev-сервер**

Run:
```bash
pnpm --filter @gmd/web dev
```
Открыть http://localhost:3003/cabinet в браузере (после логина), проверить что в хедере справа внизу виден `v0.17.1`. Остановить dev (`Ctrl+C`).

Если версия не 0.17.1 — проверить, что cabinet-header действительно читает из package.json и import JSON отработал.

- [ ] **Step 10.8: Запустить полный check**

Run:
```bash
pnpm version:check
```
Expected: `✓ Version 0.17.1 consistent across monorepo.`

- [ ] **Step 10.9: Коммит**

```bash
git add apps/web/components/cabinet/cabinet-header.tsx apps/web/next.config.ts
git rm apps/web/lib/version.ts
git commit -m "refactor(web): версия из package.json, удалён lib/version.ts"
```

---

## Task 11: Pre-commit hook — добавить version:check

**Files:**

- Modify: `.husky/pre-commit`

- [ ] **Step 11.1: Открыть и расширить hook**

Открыть [.husky/pre-commit](.husky/pre-commit). Текущее содержимое:
```
pnpm lint-staged
```

Заменить на:
```
pnpm lint-staged
pnpm version:check
```

- [ ] **Step 11.2: Проверить, что hook срабатывает**

Сделать тестовое изменение:
```bash
echo "" >> README.md
git add README.md
git commit -m "test: pre-commit"
```
Expected: hook выполняется, `version:check` проходит (`✓ Version 0.17.1 consistent`), коммит создаётся. Затем откатить тестовый коммит:
```bash
git reset HEAD~1
git checkout README.md
```

- [ ] **Step 11.3: Негативный тест — искусственный рассинхрон**

Временно изменить версию в `apps/web/package.json` на `9.9.9`:
```bash
# редактируем вручную или: sed -i 's/"version": "0.17.1"/"version": "9.9.9"/' apps/web/package.json
```
Run:
```bash
echo "" >> README.md
git add README.md apps/web/package.json
git commit -m "test: should fail"
```
Expected: hook падает с `✗ Version mismatch (root 0.17.1)` и указанием файла. Коммит не создаётся.

Откатить:
```bash
git checkout apps/web/package.json README.md
```

- [ ] **Step 11.4: Коммит hook-изменения**

```bash
git add .husky/pre-commit
git commit -m "chore(husky): pre-commit проверяет version:check"
```

---

## Task 12: CI workflow — version-check

**Files:**

- Create: `.github/workflows/version-check.yml`

- [ ] **Step 12.1: Создать workflow**

Создать `.github/workflows/version-check.yml`:

```yaml
name: version consistency

on:
  pull_request:
  push:
    branches: [main]

jobs:
  version-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts

      - name: Validate version consistency
        run: pnpm version:check

      - name: Run sync-version unit tests
        run: node --test scripts/sync-version.test.mjs
```

- [ ] **Step 12.2: Коммит**

```bash
git add .github/workflows/version-check.yml
git commit -m "ci: workflow version-check (версии консистентны, юнит-тесты sync-version)"
```

- [ ] **Step 12.3: Push ветки и проверить, что workflow запустился в GitHub Actions**

Run:
```bash
git push origin claude/interesting-volhard-82c6c5
```

Проверить:
```bash
gh run list --branch claude/interesting-volhard-82c6c5 --limit 3
```
Expected: есть запись `version consistency` со статусом `completed` / `success`. Если `failure` — открыть логи (`gh run view --log`) и починить.

---

## Task 13: Документация — обновить CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 13.1: Найти раздел «Документация и CHANGELOG (обязательно)» в CLAUDE.md**

Найти раздел начинающийся с `## Документация и CHANGELOG (обязательно)`. В конце «Правило №2: CHANGELOG — по SemVer и конвенции» добавить новый подраздел:

```markdown
### Правило №3: единый источник версии

**Source of truth — корневой [package.json](package.json), поле `version`.** Все производные версии (apps/\*/package.json, mobile-\*/pubspec.yaml X.Y.Z часть, Sentry release, версия в UI кабинета) выводятся из него через `pnpm version:sync`.

**Релизный workflow:**

```bash
# 1. Обновить CHANGELOG.md — добавить блок ## vX.Y.Z сверху
# 2. Bump корневой package.json (правим вручную или через npm version)
npm version X.Y.Z --no-git-tag-version --workspaces=false

# 3. Распространить в apps
pnpm version:sync

# 4. Валидация
pnpm version:check

# 5. Если релизим mobile — bump Flutter build number (+N) отдельно
#    (sync X.Y.Z не трогает build number — это сохраняет versionCode для RuStore)

# 6. Коммит + тег
git add -A && git commit -m "chore: release vX.Y.Z" && git tag vX.Y.Z
```

**Проверки:**
- `pnpm version:check` — локально и в pre-commit hook
- CI workflow `.github/workflows/version-check.yml` — падает при рассинхроне, гарантия для main

**Запрещено:** править версию только в одном файле, держать `apps/web/lib/version.ts` (удалён — импорт из `@/package.json`).
```

- [ ] **Step 13.2: Коммит**

```bash
git add CLAUDE.md
git commit -m "docs(claude): правило №3 — единый источник версии + релизный workflow"
```

---

## Task 14: Финальная верификация

- [ ] **Step 14.1: Полный прогон check**

Run:
```bash
pnpm version:check
```
Expected: `✓ Version 0.17.1 consistent across monorepo.`

- [ ] **Step 14.2: Полный прогон unit-тестов**

Run:
```bash
node --test scripts/sync-version.test.mjs
```
Expected: все тесты passed (минимум 10 штук — по одному per feature).

- [ ] **Step 14.3: Typecheck + lint web**

Run:
```bash
pnpm --filter @gmd/web typecheck
pnpm --filter @gmd/web lint
```
Expected: no errors.

- [ ] **Step 14.4: Ещё раз визуально через dev**

Run:
```bash
pnpm --filter @gmd/web dev
```
Открыть `/cabinet`, убедиться что `v0.17.1` виден в хедере и в mobile-меню.

- [ ] **Step 14.5: Посмотреть git log**

Run:
```bash
git log --oneline origin/main..HEAD
```
Expected: ~13 атомарных коммитов, все Conventional Commits.

- [ ] **Step 14.6: Проверить, что CI прошёл на последнем push**

Run:
```bash
gh run list --branch claude/interesting-volhard-82c6c5 --limit 3
```
Expected: `version consistency` — `success`.

---

## Sanity checks перед готово

- [ ] Корневой `package.json#version` = `0.17.1`
- [ ] Все `apps/*/package.json#version` = `0.17.1`
- [ ] `apps/mobile-child/pubspec.yaml` = `0.17.1+11` (build number сохранён)
- [ ] `apps/mobile-parent/pubspec.yaml` = `0.17.1+1`
- [ ] `apps/web/lib/version.ts` — **удалён**
- [ ] В хедере кабинета на `/cabinet` виден `v0.17.1`
- [ ] `pnpm version:check` — exit 0
- [ ] `pnpm version:sync` — идемпотентен (второй запуск ничего не меняет)
- [ ] Pre-commit hook ловит рассинхрон
- [ ] CI workflow запускается на PR и push
- [ ] CLAUDE.md обновлён (правило №3)

---

## Out of scope (не делаем в этом плане)

- Полный CI pipeline для web/backend (lint/typecheck/test) — отдельная задача.
- Автоматический bump build number для Flutter (`mobile:bumpcode`) — отдельная задача, делается при первой подготовке релиза mobile.
- `/healthz` эндпоинт backend с версией — отдельная задача.
- Миграция на semantic-release / changesets — сознательно не делаем, CHANGELOG ведётся вручную.
- Backfill прошлых релизов в root package.json задним числом — фиксируем только актуальную `0.17.1`.
