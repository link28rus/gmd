---
name: gmd-development
description: Use when working on GMD project — self-hosted parental control & child geolocation (аналог «Где мои дети») in d:/Project/GMD. Load when implementing features, fixing bugs, deploying, or doing any development across backend (NestJS), web (Next.js 15), mobile-parent / mobile-child (Flutter), or infra.
---

# GMD Development Reference

Self-hosted сервис родительского контроля и геолокации детей (аналог gdemoideti.ru), РФ-рынок, 152-ФЗ. Полный контекст: [D:/Project/GMD/CLAUDE.md](D:/Project/GMD/CLAUDE.md), дизайн MVP: `docs/superpowers/specs/2026-04-18-gmd-mvp-design.md`.

## Project Layout

```
D:/Project/GMD/                                       # ВСЕГДА работаем тут, не в worktree
  apps/backend/        — NestJS, port 3001
  apps/web/            — Next.js 15 (App Router), port 3000
  apps/mobile-parent/  — Flutter (Android + iOS)
  apps/mobile-child/   — Flutter (Android only на MVP)
  packages/shared-types/  — TS из OpenAPI
  packages/shared-dart/   — Dart из OpenAPI
  packages/ui/            — shadcn/ui base
  infra/docker/        — docker-compose.{dev,prod}.yml
  infra/caddy/         — Caddyfile (prod, gmd.link28rus.ru)
  infra/deploy/        — deploy.sh
  docs/                — спеки, runbook'и, политики
  .taskmaster/         — gmd-taskmaster (задачи, PRD, complexity)
```

Менеджер: **pnpm workspaces + Turborepo** (JS/TS), **Melos** (Flutter).
Все JS-команды из корня; Flutter — из соответствующего `apps/mobile-*/`.

## Critical Rules — never break

### 1. Все нетривиальные задачи — через `gmd-taskmaster`

Любая фича/баг/рефакторинг/деплой = задача в `.taskmaster/tasks/tasks.json`. **Не «свободный» код в обход системы.**

```text
# Старт сессии
mcp__gmd-taskmaster__next_task           → следующая задача
mcp__gmd-taskmaster__get_task <id>        → детали

# Перед началом работы
mcp__gmd-taskmaster__set_task_status id=<id> status=in-progress

# В процессе — логировать факты в задачу
mcp__gmd-taskmaster__update_subtask id=<id> prompt="что сделано / что не зашло"

# Новая задача (не в плане) — добавить, не «потерять»
mcp__gmd-taskmaster__add_task prompt="..." priority=medium

# Завершение
mcp__gmd-taskmaster__set_task_status id=<id> status=done
```

Исключения (без задачи): однострочный typo-fix, опечатка в README, `git push` уже готовых коммитов, ответ на вопрос пользователя без правок кода. Всё остальное → `add_task` или `next_task` ПЕРВЫМ действием.

### 2. Memory-compiler — первым действием в каждой сессии

`mcp__memory-compiler__start_task` (или `search` / `get_active_context`) ДО любого другого тула. После нетривиальной задачи — `finish_task`. Никаких других vault'ов не существует.

### 3. Никогда не работать в git worktree

Все правки только в `D:/Project/GMD/`. Если харнесс закинул в `.claude/worktrees/<name>/` — игнорировать cwd, использовать абсолютные пути к основному репо. **Причина:** untracked-работа пользователя не попадает в worktree → видишь «фантомные заглушки» там, где фича уже реализована.

### 4. Документация и CHANGELOG — в том же коммите

- API меняется → OpenAPI + regenerate клиенты в том же коммите.
- User-facing фича → `CHANGELOG.md` + bump SemVer + `pnpm version:sync`.
- Архитектурное решение → `docs/superpowers/specs/YYYY-MM-DD-<topic>.md` + `mcp__memory-compiler__save_decision`.
- «Задокументирую потом» = не задокументирую.

### 5. Single source of version truth — корневой `package.json`

```bash
npm version X.Y.Z --no-git-tag-version --workspaces=false   # bump root
pnpm version:sync                                            # распространить в apps
pnpm version:check                                           # валидация
# mobile: build number (+N) bump'ится отдельно перед сборкой APK
```

Запрещено: править версию в одном файле в обход `version:sync`; возвращать `apps/web/lib/version.ts` (удалён, UI читает `process.env.APP_VERSION`).

### 6. UI-тексты — на русском

Все user-facing строки в кабинете, mobile-приложениях, ошибках, push'ах — на русском. Идентификаторы кода и API-имена — английский.

### 7. При релизе — публикация APK на прод обязательна

Bump build number = собрать APK всех 3 ABI, выложить в `/opt/gmd/download/` на 192.168.1.23, удалить старые, проверить `https://gmd.link28rus.ru/download`. Без этого релиз mobile-child не считается завершённым.

### 8. Verification = реально запустить, не «выглядит правильно»

Typecheck + lint + unit ≠ проверка фичи. Mobile перед релизом — установить APK на устройство. Backend/web — дёрнуть endpoint реально. Не можешь проверить (нет устройства / API-ключа) — честно сказать пользователю, не маскировать под «готово».

### 9. Install APK на устройство пользователя — НИКОГДА без проверки signature (data loss risk)

**Что произошло раньше (ЛИЧНЫЙ ОПЫТ):** `flutter install` снёс данные приложения у пользователя через скрытый `adb uninstall` перед install (когда подписи APK различаются). Это уничтожило локальные refresh-токены, кэш, настройки. Backend-данные уцелели только потому что были на сервере.

**Обязательный pre-install чеклист:**

```bash
# 1. Какая версия и подпись СЕЙЧАС на устройстве?
adb -s <device> shell dumpsys package <package_id> | grep -E "versionCode|signatures"

# 2. Какая подпись у нового APK?
"<sdk>/build-tools/<ver>/apksigner.bat" verify --print-certs <new.apk> | grep "SHA-1"

# 3. Сравни SHA-1. Если ОДИНАКОВЫЕ → install -r без uninstall, БЕЗ data loss.
#    Если РАЗНЫЕ → СПРОСИ пользователя, не делай install автоматом!
```

**Никогда не использовать `flutter install`** на устройстве пользователя — он сам делает `adb uninstall` если подписи различаются. Только так:

```bash
flutter build apk --release --split-per-abi --build-number=N    # сборка
adb -s <device> install -r build/app/outputs/flutter-apk/<abi>-release.apk  # reinstall, без uninstall
```

**Override versionCode без правки pubspec:** `--build-number=N`. Полезно когда на устройстве установлен APK с большим build-number чем в pubspec — чтобы не было `INSTALL_FAILED_VERSION_DOWNGRADE`.

**Для downgrade (новый build < старого):** добавь `-d` к adb install (`adb install -r -d`).

**Текущая инфра-баг:** в `apps/mobile-parent/android/app/build.gradle.kts:37` release подписан **debug-keystore** этой машины (`signingConfig = signingConfigs.getByName("debug")`). Это означает: APK можно собирать **ТОЛЬКО** на одной конкретной Windows-машине (`C:\Users\link2\.android\debug.keystore`). На любой другой — другой debug-key → data loss у всех пользователей при обновлении. Долгосрочно нужно: production keystore + `apps/mobile-parent/android/key.properties` (в .gitignore) + bump signingConfig в build.gradle.kts.

### 10. Не доверять taskmaster-статусам — проверять реальное состояние перед началом работы

**Что произошло раньше:** taskmaster показывал 23 задачи pending, `next_task` возвращал #30 (deps init из Phase 1.2). Реально #30-#48 давно done в проде (релиз v0.6.0 от 2026-04-19). Действовать по `next_task` без проверки = делать уже сделанную работу.

**Перед `set_task_status in-progress`** — короткая разведка через Explore-agent или прямой Glob/Grep: «существует ли описанный файл/функция/endpoint в коде». Если да — задача уже done, пометить и брать следующую. Это особенно важно для исторических задач (статусы могут не обновляться в процессе).

## Local Environment (Windows, git-bash)

`which <tool>` даёт false negative — SDK на дисках, но не в PATH git-bash. Абсолютные пути:

| Tool               | Path                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `flutter` / `dart` | `D:\flutter\bin\` (для bash: `/d/flutter/bin/`). Перед mobile-работой: `export PATH="/d/flutter/bin:$PATH"` |
| `pnpm`             | `C:\Users\link2\AppData\Roaming\npm\pnpm.cmd`                                                               |
| `psql`             | НЕ установлен. Использовать `docker exec gmd-postgres-dev psql -U gmd -d gmd_dev -c "..."`                  |

Если тула нет в PATH — **искать PowerShell'ом ДО docker-workaround**:

```powershell
Get-ChildItem -Path C:\,D:\ -Filter '<tool>.bat' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 3
```

## Dev Workflow

```bash
# Стек (Postgres+PostGIS, Redis, MinIO, Adminer)
pnpm stack:up               # поднять
pnpm stack:down             # остановить (volumes сохраняются)
pnpm stack:reset            # сброс БД!
pnpm stack:logs

# Приложения
pnpm dev                    # backend (3001) + web (3000) параллельно
pnpm --filter @gmd/backend dev
pnpm --filter @gmd/backend prisma migrate dev --name <name>
pnpm --filter @gmd/backend prisma studio

# Mobile (требует flutter в PATH)
cd apps/mobile-parent && flutter run
cd apps/mobile-child && flutter run
melos run analyze

# Качество кода
pnpm lint
pnpm typecheck
pnpm test
pnpm version:check
```

**Локальные порты dev-машины** (если 5432/6379/9000 заняты):
`POSTGRES_PORT=54320`, `REDIS_PORT=63790`, `MINIO_API_PORT=9050`, `MINIO_CONSOLE_PORT=9051`.

## Healthchecks

- Backend liveness: `http://localhost:3001/healthz`
- Backend readiness: `http://localhost:3001/readyz` (БД + Redis)
- Web: `http://localhost:3000/api/healthz`

## Production Server (gmd-prod)

| Поле      | Значение                                                                           |
| --------- | ---------------------------------------------------------------------------------- |
| LAN       | `192.168.1.23` (`ens160`, gateway 192.168.1.1) — SSH из локалки                    |
| WAN       | `95.104.240.111/27` (`ens192`, gateway 95.104.240.97, прямой публичный IP без NAT) |
| Домен     | `gmd.link28rus.ru`                                                                 |
| App path  | `/opt/gmd/`                                                                        |
| SSH alias | `gmd-prod` (см. `~/.ssh/config`)                                                   |
| Bridges   | docker `172.17.0.0/16`, `172.18.0.0/16` — не трогать                               |

```bash
# Деплой текущего main на prod
bash infra/deploy/deploy.sh

# Проверки
curl http://192.168.1.23/api/readyz                  # {status:ok,db:up,redis:up}
ssh gmd-prod 'docker ps --format "{{.Names}} {{.Status}}"'
ssh gmd-prod 'systemctl list-timers | grep pg-'
ssh gmd-prod 'ls /opt/gmd/backups/postgres/'

# Мониторинг (через SSH-tunnel)
ssh -N gmd-prod-tunnels   # GlitchTip + Uptime Kuma
```

**Asymmetric routing fix** для входящего на `ens192` — через CONNMARK fwmark 0x2 + ip rule в netplan + iptables-persistent. Runbook в memory-compiler «Asymmetric routing fix на gmd-prod (multi-WAN)».

## Stack at a glance

| Слой     | Технология                                                                          |
| -------- | ----------------------------------------------------------------------------------- |
| Mobile   | Flutter 3.x, Riverpod, Dio, Drift, yandex_mapkit, firebase_messaging + RuStore Push |
| Web      | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, Zod                       |
| Backend  | NestJS, PostgreSQL 16 + PostGIS + pg_cron, Redis, MinIO                             |
| API      | REST + OpenAPI 3.1, codegen TS + Dart                                               |
| Auth     | JWT (access 15m + refresh 30d) + long-lived device-token для детей                  |
| Realtime | Short-polling + FCM/RuStore push (без WebSocket на MVP)                             |
| Карты    | Яндекс.Карты                                                                        |
| Infra    | Docker Compose, Caddy, GlitchTip, Uptime Kuma, Grafana+Loki+Prometheus              |

## Common Mistakes (lessons learned, не повторять)

| Mistake                                                     | Correct                                                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flutter install` на устройство пользователя                | **СНОСИТ ДАННЫЕ** через скрытый `adb uninstall`. Только `flutter build apk` + `adb install -r`. Сначала проверить SHA-1 подписи (apksigner verify --print-certs vs dumpsys signatures) |
| `set_task_status in-progress` сразу по `next_task`          | Сначала проверить реально ли задача pending — Explore-agent / Glob по описанным файлам. Старые задачи часто done но не помечены                                                        |
| Начать кодить без `next_task` / `add_task` в gmd-taskmaster | Любая нетривиальная работа — задача в taskmaster ПЕРВЫМ действием                                                                                                                      |
| Работать в `.claude/worktrees/<name>/` cwd                  | Игнорировать worktree-cwd, абсолютные пути к `D:/Project/GMD/`                                                                                                                         |
| `which flutter` → «нет» → docker-workaround                 | `Get-ChildItem` PowerShell'ом → `D:\flutter\bin\`                                                                                                                                      |
| Bump версии в одном файле                                   | `npm version` root + `pnpm version:sync` + `pnpm version:check`                                                                                                                        |
| Релиз mobile-child без выкладки APK на прод                 | Build number bump → собрать 3 ABI → `/opt/gmd/download/` → проверить `/download`                                                                                                       |
| Удалить «соседнюю» фичу заодно с целевой                    | Перед удалением — grep callers/references, спросить «это ТОЛЬКО про X?»                                                                                                                |
| Реверс-инжиниринг security-бага без DiagLog                 | ПЕРВЫМ действием — попросить DiagLog/repro/screenshot. Mobile-child DiagLog: `/debug` (long-press на версии в header)                                                                  |
| Backend-флаг = состояние на устройстве                      | Держать в UI два индикатора: server-flag + local-permission. Шаблон `(server, local) → UI {on/off/misconfigured}`                                                                      |
| «Сделай как Pingo» без их ограничений                       | Изучить known limitations конкурента, воспроизводить целиком (включая trade-offs). Protection theatre хуже честной защиты с документированным ограничением                             |
| Английский в UI                                             | Только русский для user-facing строк                                                                                                                                                   |
| Деплой без проверки git status                              | Коммит → push → `bash infra/deploy/deploy.sh`                                                                                                                                          |
| Skip `finish_task` после задачи                             | После каждой нетривиальной работы — `mcp__memory-compiler__finish_task`                                                                                                                |

## Where things live

| Что нужно                                    | Где смотреть                                                        |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Текущие задачи                               | `mcp__gmd-taskmaster__get_tasks` или `.taskmaster/tasks/tasks.json` |
| PRD / спеки                                  | `docs/superpowers/specs/`                                           |
| Архитектурные решения                        | `mcp__memory-compiler__search` (project=gmd)                        |
| Runbook'и (asym routing, бэкапы, OEM-quirks) | `mcp__memory-compiler__get_runbook`                                 |
| Деплой                                       | `docs/deploy.md`, `infra/deploy/deploy.sh`                          |
| Бэкапы                                       | `docs/backup-restore.md`                                            |
| Server hardening                             | `docs/server-hardening.md`                                          |
| Мониторинг                                   | `docs/monitoring.md`                                                |
| CHANGELOG                                    | `CHANGELOG.md` (корень) + страница `/changelog` в кабинете          |

## Privacy / 152-ФЗ

- Хранение ПДн только в РФ ✓
- Политика конфиденциальности + версионированное согласие при регистрации
- `DELETE /me` → soft-delete → hard-delete через 30 дней (pg_cron)
- Retention локаций: 30 дней (pg_cron)
- Согласие 14+: отдельное в claim invite
- Уведомление РКН — перед публичным запуском

При добавлении новых данных/эндпоинтов: чек-лист 152-ФЗ (TODO: вынести в `gmd-152fz-compliance` skill).

## Related skills (use proactively)

- `memory-autopilot` — всегда, контекст между сессиями
- `frontend-design:frontend-design` — UI кабинета, лендинг
- `design:design-system`, `design:accessibility-review`, `design:ux-copy`
- `chrome-devtools-mcp:*`, `webapp-testing` — отладка/тесты web
- `doc-coauthoring`, `anthropic-skills:docx`, `anthropic-skills:pdf` — юр. документы
- `superpowers:*` — **только по явному запросу пользователя**

## Subagents (когда удобнее делегировать)

| Задача                                  | Агент                                     |
| --------------------------------------- | ----------------------------------------- |
| NestJS-модули, бизнес-логика            | `backend-developer`                       |
| REST/OpenAPI design                     | `api-designer`                            |
| Next.js 15, кабинет, лендинг            | `nextjs-developer`                        |
| Сложные TS-типы, codegen                | `typescript-pro`                          |
| PG-настройки, индексы, PostGIS, pg_cron | `database-administrator` + `sql-pro`      |
| Dockerfile, compose                     | `docker-expert`                           |
| CI/CD, Caddy, бэкапы                    | `devops-engineer` / `deployment-engineer` |
| 152-ФЗ, OWASP, pentests                 | `security-auditor`                        |
| Перед merge                             | `code-reviewer`                           |
| Playwright, supertest, integration_test | `test-automator`                          |
| Баги                                    | `debugger`                                |
| Flutter/Dart (нет спец. агента)         | `general-purpose`                         |
| Исследования по кодбазе                 | `Explore`                                 |
| Планирование крупных изменений          | `Plan`                                    |

## Out of scope for this skill

- Подробности 152-ФЗ-чеклиста — выносим в отдельный `gmd-152fz-compliance` (TODO).
- Полный SSH/Docker runbook prod-сервера — выносим в `gmd-docker-ops` + `gmd-ssh` (TODO).
- pg_dump/restore/anonymize — `gmd-db-backup` (TODO).
- Flutter release pipeline (split-per-abi, RuStore upload) — `gmd-mobile-flutter` (TODO).
