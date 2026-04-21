# Design: единый источник версии GMD

**Дата:** 2026-04-21
**Статус:** утверждён к реализации
**Автор:** link28rus + Claude
**Связанные документы:** [CLAUDE.md](../../../CLAUDE.md) (раздел CHANGELOG), [CHANGELOG.md](../../../CHANGELOG.md)

## Контекст и проблема

В монорепо GMD обнаружен рассинхрон версий:

- `apps/web/package.json#version` = `0.11.0`
- `apps/web/lib/version.ts#APP_VERSION` = `0.17.1` (видна в хедере кабинета)
- `apps/backend/package.json#version` = `0.11.0` (никогда не обновлялась)
- `apps/mobile-child/pubspec.yaml` = `0.15.3+11`
- `apps/mobile-parent/pubspec.yaml` = `1.0.0+1` (дефолт Flutter, не релизилась)
- Корневой `package.json#version` = `0.11.0`
- Верхняя запись в `CHANGELOG.md` = `## v0.17.1 — 2026-04-21`

CHANGELOG и UI утверждают, что продукт на `0.17.1`. Но `package.json` во всех пакетах отстал. Sentry release берётся из `process.env.APP_VERSION`, но переменная сейчас нигде не устанавливается из кода — только вручную в окружении деплоя.

Причина — нет единого источника правды и нет автоматической проверки согласованности. При bump версии разработчик обновляет «какой-то один» файл и забывает про остальные.

## Цели

1. Один канонический источник версии на весь монорепо.
2. Автоматическая синхронизация всех производных файлов.
3. CI-проверка, падающая при рассинхроне — невозможно смержить PR с расходящимися версиями.
4. CHANGELOG остаётся обязательной частью релиза (согласно CLAUDE.md).
5. Build numbers мобильных приложений (+N) не затираются при bump X.Y.Z, чтобы не сломать загрузку в RuStore/Google Play.

## Решения

### 1. Модель версионирования

**Продуктовая версия — одна на монорепо.** Все apps (web, backend, mobile-child, mobile-parent) идут под единой версией `X.Y.Z`. Любой релиз любого компонента двигает общую версию. CHANGELOG ведётся как сейчас — в одной записи могут быть изменения только web, только mobile-child или микс.

Это отражает реальность: CHANGELOG уже ведётся именно так, и продуктовая коммуникация идёт под единой версией.

### 2. Source of truth

**Корневой [package.json](../../../package.json), поле `version`.** Стандартный npm-канонический источник, работает с `npm version` / `pnpm version`, доступен через `process.env.npm_package_version` при запуске из root.

Текущее значение после рефакторинга = **`0.17.1`** (актуальная версия из CHANGELOG и UI web).

### 3. Производные версии

| Файл | Значение | Как получает |
| --- | --- | --- |
| `package.json` (root) | `0.17.1` | **source** |
| `apps/web/package.json` | `0.17.1` | `sync-version` скрипт |
| `apps/backend/package.json` | `0.17.1` | `sync-version` скрипт |
| `apps/mobile-child/pubspec.yaml` | `0.17.1+11` | `sync-version` меняет только X.Y.Z; build number (+11) сохраняется |
| `apps/mobile-parent/pubspec.yaml` | `0.17.1+1` | то же |
| `apps/web/lib/version.ts` | **удаляется** | UI импортирует из `package.json` напрямую |
| `process.env.APP_VERSION` (Sentry) | `0.17.1` | `next.config.js` пробрасывает из `package.json` |

### 4. Build numbers (+N) для Flutter

Build number (`versionCode` на Android, `CFBundleVersion` на iOS) обязан **монотонно расти** при загрузке в RuStore/Google Play. Две разные сборки с одним versionCode сторы отклоняют.

**Правило:** `sync-version` НЕ трогает build number. Он инкрементируется отдельной командой перед сборкой APK:

```bash
pnpm --filter mobile-child mobile:bumpcode   # +11 → +12
```

Реализация команды — отдельный вопрос плана (может быть простейший sed-скрипт или пакет `cider`).

Текущий mobile-child на `0.15.3+11`. После `sync-version` станет `0.17.1+11`. Перед следующей сборкой под RuStore — `bumpcode` → `0.17.1+12`.

## Компоненты

### 4.1 `scripts/sync-version.mjs`

Один node-скрипт, две команды:

```bash
pnpm version:sync       # распространяет root version в производные файлы
pnpm version:check      # валидация (для CI и pre-commit), exit code 0/1
```

**`version:sync` делает:**

1. Читает `package.json#version` в корне.
2. Пишет эту же версию в:
   - `apps/web/package.json` (поле `version`)
   - `apps/backend/package.json` (поле `version`)
3. В pubspec'ах обновляет только X.Y.Z часть строки `version: X.Y.Z+N`, сохраняя `+N`:
   - `apps/mobile-parent/pubspec.yaml`
   - `apps/mobile-child/pubspec.yaml`
4. Идемпотентно. Запуск на уже синхронизированном репо ничего не меняет.

**`version:check` проверяет:**

1. Версия в трёх `package.json` одинакова.
2. X.Y.Z часть в обоих `pubspec.yaml` равна root version.
3. Верхняя запись `## vX.Y.Z — YYYY-MM-DD` в `CHANGELOG.md` совпадает с root version.
4. Файл `apps/web/lib/version.ts` отсутствует (чтобы старый источник не вернулся).

При несовпадении печатает human-readable diff и выходит с кодом 1.

**Парсинг pubspec.yaml:** без полного YAML-парсера, только regex `^version:\s*(\S+)\s*$` на нужной строке. Минимально хрупко.

**Парсинг CHANGELOG.md:** regex `^## v(\d+\.\d+\.\d+)` на первой такой строке в файле.

### 4.2 `apps/web/components/cabinet/cabinet-header.tsx`

Меняем источник константы версии:

```ts
// было
import { APP_VERSION } from '@/lib/version';

// станет
import pkg from '@/package.json';
const APP_VERSION = pkg.version;
```

Next.js 15 + `resolveJsonModule: true` это поддерживает. Bundler включит только использованное поле, не весь package.json.

### 4.3 `apps/web/next.config.js`

Проброс версии в runtime для Sentry:

```js
const pkg = require('./package.json');
module.exports = {
  env: { APP_VERSION: pkg.version },
  // существующая конфигурация...
};
```

После этого `process.env.APP_VERSION` в [apps/web/sentry.server.config.ts](../../../apps/web/sentry.server.config.ts) будет всегда корректен.

### 4.4 `apps/web/lib/version.ts` — удалить

Файл больше не нужен: все потребители переключаются на импорт `package.json` или `process.env.APP_VERSION`.

### 4.5 Husky pre-commit hook

В существующий [.husky/pre-commit](../../../.husky/pre-commit) (если его нет — создать) добавить шаг:

```bash
pnpm version:check
```

Падает локально до коммита. Быстрее, чем ждать CI.

### 4.6 `.github/workflows/version-check.yml`

Новый workflow, запускается на `pull_request` и `push` в `main`:

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
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: pnpm
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm version:check
```

Гарантия: рассинхрон не попадёт в main даже если кто-то обошёл pre-commit через `--no-verify`.

### 4.7 Корневые npm-скрипты

В [package.json](../../../package.json):

```json
{
  "scripts": {
    "version:sync": "node scripts/sync-version.mjs sync",
    "version:check": "node scripts/sync-version.mjs check"
  }
}
```

## Workflow релиза (документируется в CLAUDE.md)

```bash
# 1. Обновить CHANGELOG.md — добавить блок ## v0.17.2 сверху
vim CHANGELOG.md

# 2. Bump корневой package.json
npm version 0.17.2 --no-git-tag-version --workspaces=false
# (или вручную поменять "version": "0.17.2" в корне)

# 3. Распространить в apps
pnpm version:sync

# 4. Валидация
pnpm version:check   # должно пройти

# 5. Если релизим mobile-child/parent — bump build number
pnpm --filter mobile-child mobile:bumpcode

# 6. Коммит + тег
git add -A
git commit -m "chore: release v0.17.2"
git tag v0.17.2
```

## Тестирование

Для `scripts/sync-version.mjs` — юнит-тесты через Jest или `node --test`:

1. **Happy path sync.** Временный репо-снимок с расходящимися версиями → `sync` → все файлы синхронизированы, build numbers сохранены.
2. **Happy path check.** Синхронный репо → `check` exit 0.
3. **Check ловит рассинхрон package.json.** Подменяем `apps/web/package.json` на старую версию → exit 1, в выводе имя файла.
4. **Check ловит расходящийся CHANGELOG.** Верхняя запись `## v0.17.0` при root version `0.17.1` → exit 1.
5. **Check ловит возврат version.ts.** Создаём `apps/web/lib/version.ts` → exit 1.
6. **Sync сохраняет build number.** `0.15.3+11` → root bump на `0.17.1` → `sync` → `0.17.1+11`.
7. **Sync идемпотентен.** Два запуска подряд — второй ничего не меняет, файлы байт-в-байт те же.

Тесты пишутся через TDD — red/green/refactor.

## Документация (обновляется в том же PR)

- [CLAUDE.md](../../../CLAUDE.md) раздел «CHANGELOG — по SemVer и конвенции» — добавить подраздел «Источник правды — корневой `package.json`. При bump — всегда `pnpm version:sync` + `pnpm version:check`. CHANGELOG обязателен».
- Этот дизайн-док.

## Что НЕ делаем (YAGNI)

- Не парсим CHANGELOG для извлечения версии (только сверяем верхнюю запись).
- Не делаем отдельный файл `VERSION` или `version.json`.
- Не автобампим build number Flutter в sync-скрипте.
- Не поднимаем root version до прошлых релизов задним числом — фиксируем на `0.17.1`.
- Не автогенерируем `version.ts` — удаляем его.
- Не создаём полный CI-pipeline для web/backend в рамках этой задачи (только version-check workflow).
- Не используем semantic-release / changesets — CHANGELOG ведётся вручную и это сознательное решение.

## Риски и edge cases

**Next.js + import JSON.** В Next.js 15 + TypeScript с `resolveJsonModule: true` импорт `package.json` работает. Если на практике возникнет ESM/SSR проблема — фоллбэк: `scripts/gen-version.mjs` в `predev`/`prebuild` пишет `apps/web/lib/version.generated.ts` с константой, файл добавляется в `.gitignore`. Это план B, включается только при поломке.

**Husky `--no-verify`.** Пользователь может обойти pre-commit. Именно поэтому нужен CI-workflow — он ловит всё, что обошло hook.

**Mobile pubspec — YAML.** Используем regex только на одной строке, не полный YAML-парсер. Менее хрупко, чем казалось.

**Монорепо npm version.** `npm version X --workspaces=false` меняет только корневой package.json, не трогает apps. Это то, что нам нужно — `sync-version` дальше всё распространяет.

**Backend не имеет UI с версией.** Сейчас она там просто «есть» в package.json. Можно в будущем добавить в `/healthz` эндпоинт — вне scope этого дизайна.

## Критерии готовности

- [ ] `scripts/sync-version.mjs` написан, покрыт тестами (7 сценариев выше).
- [ ] `pnpm version:sync` распространяет root version во все apps, build numbers сохранены.
- [ ] `pnpm version:check` ловит все типы рассинхрона.
- [ ] Все версии в репо = `0.17.1` (кроме Flutter build numbers).
- [ ] `apps/web/lib/version.ts` удалён, импорт в `cabinet-header.tsx` переключён на `package.json`.
- [ ] `apps/web/next.config.js` пробрасывает `APP_VERSION` в env.
- [ ] Pre-commit hook запускает `version:check`.
- [ ] CI workflow `version-check.yml` создан и проходит на main.
- [ ] CLAUDE.md обновлён — зафиксирован workflow релиза.
- [ ] UI кабинета показывает `v0.17.1` (визуальная проверка через dev-сервер).
