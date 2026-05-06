---
name: gmd-deploy
description: Use when releasing a new version of GMD — bumping versions, building Flutter APKs, deploying backend+web to gmd-prod (192.168.1.23), publishing APKs to /opt/gmd/download/, and verifying the auto-update endpoint. Covers the full release flow including the gotchas from CLAUDE.md lessons #12, #14, #16. Invoke when the user asks to release/deploy a version, publish an APK, run deploy.sh, or verify a release.
---

# GMD Release & Deploy

Полный релизный flow для GMD. Состоит из ТРЁХ независимых шагов, каждый из которых можно зафейлить молча: (1) version bump + sync, (2) deploy backend+web, (3) build & publish APKs. Endpoint `/api/public/updates/<app>/latest` работает только когда сделаны ВСЕ три (lesson #16).

## Когда что нужно

| Изменение                                | Bump            | Web deploy                 | APK build & publish |
| ---------------------------------------- | --------------- | -------------------------- | ------------------- |
| Только backend/web (без mobile)          | PATCH или MINOR | ✅                         | ❌                  |
| Только mobile-parent (UI)                | PATCH или MINOR | ❌ (если route не менялся) | ✅ parent only      |
| Только mobile-child                      | PATCH или MINOR | ❌                         | ✅ child only       |
| Backend route + mobile (consume new API) | MINOR           | ✅                         | ✅                  |
| Breaking change (API контракт)           | MAJOR           | ✅                         | ✅                  |

> **Note:** route `/api/public/updates/<app>/latest` сам читает APK из `/opt/gmd/download/`, поэтому если меняется только APK (не код роута) — web-deploy не обязателен. Но если правил `lib/downloads/index.ts` или сам route — обязательно `deploy.sh`, иначе старый контейнер вернёт устаревший JSON.

## Шаг 1: Version bump + sync

Source of truth: корневой `D:/Project/GMD/package.json` поле `version`. Всё остальное (`apps/*/package.json`, `apps/mobile-*/pubspec.yaml` часть X.Y.Z, версия в UI кабинета) синхронизируется через `pnpm version:sync`.

```bash
cd D:/Project/GMD

# 1. Добавить блок ## vX.Y.Z в CHANGELOG.md СВЕРХУ (вручную, шаблон в CLAUDE.md)
#    Категории: Новые возможности / Улучшения / Исправления / Изменения

# 2. Bump root package.json
npm version X.Y.Z --no-git-tag-version --workspaces=false

# 3. Распространить в apps + apps/mobile-* (X.Y.Z часть, +N сохраняется)
pnpm version:sync

# 4. Валидация
pnpm version:check
```

`version:check` падает при: рассинхроне `apps/*/package.json`, pubspec X.Y.Z ≠ root, верхний `## vX.Y.Z` в CHANGELOG ≠ root, возврате `apps/web/lib/version.ts`.

**НЕ редактировать версию в одном файле в обход sync** — отвалится pre-commit и CI.

## Шаг 2: Bump Flutter build numbers (только если будет APK build)

Pubspec format: `version: X.Y.Z+N`. Часть `+N` — **pubspec build number**, должен **монотонно расти per ABI** (требование RuStore).

`pnpm version:sync` обновляет ТОЛЬКО X.Y.Z, `+N` сохраняется. Бампать вручную:

```bash
# apps/mobile-parent/pubspec.yaml: version: X.Y.Z+N → X.Y.Z+(N+1)
# apps/mobile-child/pubspec.yaml: version: X.Y.Z+M  → X.Y.Z+(M+1)
```

> **Lesson #14:** в имени APK `gmd-{child,parent}-X.Y.Z+N-<abi>.apk` число `N` — именно pubspec build, НЕ effective versionCode (с ABI offset). Endpoint в [apps/web/lib/downloads/index.ts:21](apps/web/lib/downloads/index.ts:21) сам формирует `effectiveBuild = ABI_VERSION[abi]*1000 + pubspecBuild`. Если положить effective в имя — endpoint вернёт неправильную buildNumber, устройства застрянут на бесконечном auto-update.

## Шаг 3: Commit + tag

```bash
cd D:/Project/GMD
git add CHANGELOG.md package.json apps/*/package.json apps/mobile-*/pubspec.yaml
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
# Push после успешного деплоя — не до:
# git push origin main vX.Y.Z
```

## Шаг 4: Backend + Web deploy на gmd-prod

```bash
cd D:/Project/GMD
bash infra/deploy/deploy.sh
```

Что делает (74 строки): tar-pipe `infra/docker`, `infra/caddy`, `apps/{backend,web}`, `packages/`, root manifests на `gmd-prod` (192.168.1.23) → `docker compose build --pull` → `prisma migrate deploy` через одноразовый контейнер ДО старта backend → `docker compose up -d` → polling healthchecks (timeout 5 мин).

Verify сразу после:

```bash
ssh gmd-prod 'curl -sS http://localhost:3001/healthz' \
  && ssh gmd-prod 'curl -sS http://localhost:3001/readyz'
# {status:ok,db:up,redis:up}

ssh gmd-prod 'docker ps --format "{{.Names}} {{.Status}}"'
# Все должны быть Up (healthy)
```

## Шаг 5: Build & publish Flutter APKs (если релиз mobile)

Path: `D:/flutter/bin/flutter` (см. CLAUDE.md «Локальное окружение»). Перед работой:

```bash
export PATH="/d/flutter/bin:$PATH"
flutter --version
```

Сборка split-per-ABI (НЕ fat-apk — RuStore требует отдельный APK на ABI):

```bash
# Mobile-parent
cd D:/Project/GMD/apps/mobile-parent
flutter build apk --release --split-per-abi
ls build/app/outputs/flutter-apk/
# app-armeabi-v7a-release.apk
# app-arm64-v8a-release.apk
# app-x86_64-release.apk

# Mobile-child — аналогично
cd D:/Project/GMD/apps/mobile-child
flutter build apk --release --split-per-abi
```

Verify подписи перед deploy на устройство (lesson #12):

```bash
# Должен быть upload.keystore SHA-1, не debug.keystore
"D:/Android/sdk/build-tools/<ver>/apksigner.bat" verify --print-certs \
  build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
```

Переименование под convention `gmd-{child,parent}-X.Y.Z+N-<abi>.apk` (lesson #14 — N это pubspec build, не effective):

```bash
# Прочитать pubspec build:
PUBSPEC_BUILD=$(grep '^version:' pubspec.yaml | cut -d'+' -f2)
VERSION=$(grep '^version:' pubspec.yaml | sed -E 's/version: ([0-9.]+).*/\1/')

# Пример переименования (parent, arm64-v8a):
cp build/app/outputs/flutter-apk/app-arm64-v8a-release.apk \
   "/tmp/gmd-parent-${VERSION}+${PUBSPEC_BUILD}-arm64-v8a.apk"
```

Upload на прод и удаление старых APK (новый Endpoint всегда отдаёт latest, но старые занимают место):

```bash
# Upload
scp /tmp/gmd-parent-X.Y.Z+N-*.apk gmd-prod:/opt/gmd/download/
scp /tmp/gmd-child-X.Y.Z+N-*.apk  gmd-prod:/opt/gmd/download/

# Удаление APK предыдущих версий (опционально, держим 2 последние версии)
ssh gmd-prod 'ls -t /opt/gmd/download/gmd-parent-*.apk | tail -n +7 | xargs -r rm'
ssh gmd-prod 'ls -t /opt/gmd/download/gmd-child-*.apk  | tail -n +7 | xargs -r rm'

# Verify
ssh gmd-prod 'ls -lh /opt/gmd/download/'
```

## Шаг 6: Verify auto-update endpoint (ОБЯЗАТЕЛЬНО)

Lesson #16: web без APK = endpoint 204; APK без web-deploy (если route менялся) = 404. Проверять надо ОБЕ ветки:

```bash
# parent — все три ABI
for abi in armeabi-v7a arm64-v8a x86_64; do
  echo "=== parent / $abi ==="
  ssh gmd-prod "curl -sSk --resolve gmd.link28rus.ru:443:127.0.0.1 \
    https://gmd.link28rus.ru/api/public/updates/mobile-parent/latest?abi=$abi"
  echo
done

# child — то же
for abi in armeabi-v7a arm64-v8a x86_64; do
  echo "=== child / $abi ==="
  ssh gmd-prod "curl -sSk --resolve gmd.link28rus.ru:443:127.0.0.1 \
    https://gmd.link28rus.ru/api/public/updates/mobile-child/latest?abi=$abi"
  echo
done
```

Корректный ответ: `{"version":"X.Y.Z","buildNumber":<effective>,"url":"https://gmd.link28rus.ru/download/gmd-...-<abi>.apk"}`. Где `effective = ABI_VERSION[abi]*1000 + pubspecBuild`.

Mismatched варианты:

- **204 No Content** → APK с правильным именем нет в `/opt/gmd/download/` (или regex не матчит — сверь имя с конвенцией).
- **404 Not Found** → web-контейнер старый, не задеплоен. Запусти `bash infra/deploy/deploy.sh`.
- **JSON есть, но buildNumber подозрительно большой** → в имени APK положили effective (lesson #14). Удали, пересобери с правильным `+N`.

## Шаг 7: Push tag + создать GitHub release

```bash
cd D:/Project/GMD
git push origin main vX.Y.Z

# Опционально — release notes из CHANGELOG
# (вытащить блок ## vX.Y.Z из CHANGELOG.md и положить в --notes)
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <(awk "/^## v${VERSION//./\\.}/{flag=1;next}/^## v/{flag=0}flag" CHANGELOG.md)
```

## Шаг 8: Verify на реальном устройстве (lesson #12 — никогда не `flutter install`!)

```bash
# Проверка подписи устройства vs нового APK
adb shell dumpsys package com.gmd.parent | grep -A1 signatures
"D:/Android/sdk/build-tools/<ver>/apksigner.bat" verify --print-certs gmd-parent-X.Y.Z+N-arm64-v8a.apk

# Если SHA-1 совпадают:
adb install -r gmd-parent-X.Y.Z+N-arm64-v8a.apk
# -r = reinstall, не делает uninstall, данные сохраняются

# Если разные → СПРОСИТЬ пользователя, не делать install автоматом!
```

В app дёрнуть «Проверить обновления» (mobile-parent v0.47.0+) — должна показать «у вас актуальная версия» если устройство совпало с endpoint'ом.

## Critical Rules

1. **НЕ `flutter install`** на чужом устройстве — он делает `adb uninstall` если подписи разные → wipes user data (lesson #12). Только `apksigner verify` + `adb install -r`.
2. **APK naming = pubspec build, не effective** (lesson #14). N после `+` в имени файла — это значение в `pubspec.yaml`, не результат вычисления `ABI*1000 + N`.
3. **Версии монотонно растут** для RuStore (`+N` per ABI). Не откатывать `+N` обратно.
4. **Verify endpoint после публикации** — три ABI × два приложения = 6 curl-запросов. Без этого деплой считать неуспешным (lesson #16).
5. **Push после verify**, а не до. Если deploy упал — rollback тегу проще, чем по push'у.
6. **Backup БД перед миграцией** — `deploy.sh` запускает `prisma migrate deploy`, и если миграция деструктивная, должен быть свежий dump на gmd-prod (`/opt/gmd/backups/postgres/`).

## Common Pitfalls

| Симптом                                          | Причина                                   | Фикс                                                             |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------- |
| `pnpm version:check` fail                        | Рассинхрон одного файла                   | `pnpm version:sync` ещё раз                                      |
| `deploy.sh` зависает на «Ждём healthy»           | backend не стартует, миграция упала       | `ssh gmd-prod 'docker logs gmd-backend --tail 100'`              |
| Endpoint 204 на правильный ABI                   | Имя APK не матчит regex                   | Сверить с `apps/web/lib/downloads/index.ts:21`                   |
| Endpoint вернул buildNumber × 1000+ от реального | Effective vs pubspec в имени (lesson #14) | Переименовать APK в `+N` (pubspec)                               |
| Auto-update предлагает downgrade                 | На устройстве `+N` больше чем на проде    | Bump pubspec build, пересобрать                                  |
| `flutter` в `which` не находится                 | PATH в git-bash                           | `export PATH="/d/flutter/bin:$PATH"`                             |
| `apksigner verify` SHA-1 разный                  | Подписан debug ключом                     | Использовать upload-keystore, см. `android/app/build.gradle.kts` |

## Quick Reference

```bash
# Полный релиз mobile (parent + child) с web-deploy
cd D:/Project/GMD
# 1. Bump
npm version X.Y.Z --no-git-tag-version --workspaces=false
pnpm version:sync && pnpm version:check
# 2. Bump pubspec +N в apps/mobile-{parent,child}/pubspec.yaml
# 3. Commit + tag
git commit -am "chore: release vX.Y.Z" && git tag vX.Y.Z
# 4. Web deploy
bash infra/deploy/deploy.sh
# 5. APK build
export PATH="/d/flutter/bin:$PATH"
(cd apps/mobile-parent && flutter build apk --release --split-per-abi)
(cd apps/mobile-child  && flutter build apk --release --split-per-abi)
# 6. Rename + upload (см. Шаг 5 выше)
# 7. Verify endpoint (Шаг 6)
# 8. Push
git push origin main vX.Y.Z
```

## Related

- [CLAUDE.md](D:/Project/GMD/CLAUDE.md) — best-practices lessons #12, #14, #16
- [docs/deploy.md](D:/Project/GMD/docs/deploy.md) — общая инструкция деплоя + ключ Яндекс-Геокодера
- [infra/deploy/deploy.sh](D:/Project/GMD/infra/deploy/deploy.sh) — сам скрипт
- [scripts/sync-version.mjs](D:/Project/GMD/scripts/sync-version.mjs) — version sync
- [apps/web/lib/downloads/index.ts](D:/Project/GMD/apps/web/lib/downloads/index.ts) — APK regex parser + effectiveBuild logic
- `gmd-development` skill — общие правила разработки
- `gmd-flutter-developer` subagent — для Flutter-задач (`.claude/agents/`)
- Memory-compiler: lessons по релизам v0.46.x, v0.47.0
