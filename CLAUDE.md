# GMD — сервис родительского контроля и геолокации детей

Аналог gdemoideti.ru («Где мои дети»), self-hosted, РФ-рынок.
Дизайн MVP: [docs/superpowers/specs/2026-04-18-gmd-mvp-design.md](docs/superpowers/specs/2026-04-18-gmd-mvp-design.md).

## Кратко

Родитель в одном приложении получает:

- GPS-геолокацию ребёнка (Android) + историю 30 дней
- Геозоны с push при входе/выходе
- SOS-кнопка от ребёнка
- Read-only статистика экранного времени Android
- Web-кабинет + мобильные приложения родителя (Android + iOS)

Что в MVP **не делаем**: GPS-часы, чат, iOS-приложение ребёнка, мониторинг соцсетей, прослушка, платные подписки.

## Технологический стек

| Слой     | Технология                                                                          |
| -------- | ----------------------------------------------------------------------------------- |
| Mobile   | Flutter 3.x, Riverpod, Dio, Drift, yandex_mapkit, firebase_messaging + RuStore Push |
| Web      | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, Zod                       |
| Backend  | NestJS, PostgreSQL 16 + PostGIS + pg_cron, Redis, MinIO                             |
| API      | REST + OpenAPI 3.1, codegen TS + Dart                                               |
| Auth     | JWT (access 15m + refresh 30d) + long-lived device-token для детей                  |
| Realtime | Short-polling + FCM/RuStore push (без WebSocket на MVP)                             |
| Infra    | Docker Compose, Caddy, GlitchTip, Uptime Kuma, Grafana+Loki+Prometheus              |
| Карты    | Яндекс.Карты                                                                        |
| Оплаты   | ❌ на MVP (монетизация после сбора аудитории)                                       |

## Монорепо

```
apps/backend    NestJS API
apps/web        Next.js 15 (лендинг + кабинет)
apps/mobile-parent   Flutter (Android + iOS)
apps/mobile-child    Flutter (Android only на MVP)
packages/shared-types   TS из OpenAPI
packages/shared-dart    Dart из OpenAPI
packages/ui             shadcn/ui base
infra/docker            docker-compose.{dev,prod}.yml
infra/caddy             Caddyfile
docs/superpowers/specs  design docs
```

Менеджер: **pnpm workspaces + Turborepo** (JS/TS), **Melos** (Flutter).

## Инфраструктура

- **Сервер:** 192.168.1.23 (internal), 85.15.75.126 (external) — проброс портов
- **Домен:** gmd.link28rus.ru
- **Регион данных:** РФ (152-ФЗ)
- **SSH credentials:** см. memory-compiler (secret). TODO: перейти на SSH-ключи, отключить password auth.

## 152-ФЗ и приватность

- Хранение ПДн только в РФ ✓
- Политика конфиденциальности + версионированное согласие при регистрации
- `DELETE /me` → soft-delete → hard-delete через 30 дней
- Retention локаций: 30 дней (pg_cron)
- Модель согласия: родитель добавляет ребёнка по QR. Для 14+ — отдельное согласие в claim invite.
- Уведомление Роскомнадзору перед публичным запуском

## Рабочий процесс

1. **Старт фичи** → `superpowers:brainstorming` → spec в `docs/superpowers/specs/`
2. **После spec** → `superpowers:writing-plans` → implementation plan
3. **Выполнение** → `superpowers:executing-plans` или `superpowers:subagent-driven-development`
4. **Доменная логика** — обязательно TDD (`superpowers:test-driven-development`)
5. **Баги** — `superpowers:systematic-debugging` перед фиксом
6. **Перед «готово»** — `superpowers:verification-before-completion` (реально запустить, проверить)
7. **Перед merge** — `superpowers:requesting-code-review`

## Скилы для GMD

### Используем регулярно

- `memory-autopilot` — всегда, контекст между сессиями
- `superpowers:*` — основной рабочий процесс (см. выше)
- `frontend-design:frontend-design` — UI кабинета родителя, лендинг
- `design:design-system`, `design:accessibility-review`, `design:ux-copy`, `design:design-handoff`
- `chrome-devtools-mcp:chrome-devtools`, `chrome-devtools-mcp:a11y-debugging`, `chrome-devtools-mcp:debug-optimize-lcp`
- `webapp-testing` — Playwright smoke web-кабинета
- `browser-tools` — скриншоты для дизайн-итераций
- `doc-coauthoring` — политика конфиденциальности, EULA, РКН-уведомление
- `anthropic-skills:docx`, `anthropic-skills:pdf` — юр. документы
- `update-config` — хуки, permissions, env

### Нужно создать (через `anthropic-skills:skill-creator`)

- `gmd-development` — проект, пути, конвенции, dev-запуск (аналог `aquastart-development`)
- `gmd-docker-ops` — compose up/down/logs/exec на 192.168.1.23
- `gmd-db-backup` — pg_dump + restore + anonymize для dev
- `gmd-deploy` — SSH-деплой + healthcheck
- `gmd-mobile-flutter` — Flutter-конвенции, melos, codegen, релиз-процесс
- `gmd-ssh` — SSH на сервер с учётом проброса + non-root user
- `gmd-152fz-compliance` — чеклист при добавлении новых данных/эндпоинтов

## Субагенты

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

## MCP-серверы

- ✅ `memory-compiler` — контекст проекта, решения, секреты
- ✅ `gmd-taskmaster` — задачи/PRD
- ✅ `filesystem`
- ✅ `chrome-devtools-mcp`, `playwright` — отладка и тесты web
- ✅ `shadcn-ui` — компоненты
- ⏳ Добавить: `postgres` MCP (прямые запросы при отладке), `github`/`gitea` MCP (после выбора git-хостинга)

## Открытые вопросы (решить в writing-plans)

1. ORM: **Prisma** (рекомендация) vs TypeORM vs Drizzle
2. Git: GitHub приватный vs self-hosted Gitea
3. State-management Flutter: **Riverpod** (рекомендация) vs Bloc
4. Регистрация: email vs **phone + OTP** (рекомендация, российская специфика)

## Документация и CHANGELOG (обязательно)

### Правило №1: документация всегда актуальна

После любой фичи/багфикса/изменения API/конфига — обновить соответствующую документацию **в том же коммите**:

- **API меняется** → обновить OpenAPI-spec + regenerate клиенты
- **Модель данных меняется** → обновить `docs/database.md` (ERD + описание таблиц)
- **Архитектурное решение** → `docs/superpowers/specs/YYYY-MM-DD-<topic>.md` + запись в memory-compiler (`save_decision`)
- **Процесс/команды** → обновить этот CLAUDE.md
- **User-facing фича** → обновить CHANGELOG (см. ниже) + user-guide если есть

«Задокументирую потом» = не задокументирую. Либо в том же коммите, либо PR не мержится.

### Правило №2: CHANGELOG — по SemVer и конвенции

Формат — как в NiksDesk (ориентир). Файл: [CHANGELOG.md](CHANGELOG.md) в корне. Дополнительно — страница **«Что нового»** в web-кабинете родителя (рендерится из CHANGELOG.md).

**Структура записи:**

```markdown
## v1.3.50 — 2026-04-15

### Новые возможности

- **Название фичи кратко** — человекочитаемое описание, что это даёт пользователю (#123)

### Улучшения

- **Короткое название** — что стало лучше и почему это важно (#124)

### Исправления

- fix(scope): краткое описание починенного бага (#125)

### Изменения

- docs: что-то по документации
- refactor: техдолг без влияния на пользователя
```

**Правила:**

- **SemVer:** MAJOR.MINOR.PATCH. Breaking → MAJOR, фича → MINOR, fix/docs → PATCH.
- **Conventional Commits** для исправлений/техчейнджей: `fix(scope):`, `docs:`, `refactor:`, `chore:`.
- **Для пользовательских фич** — человеческие заголовки жирным + объяснение через em-dash (`—`). Не `feat(auth): add login` а `**Вход по номеру телефона** — быстрая авторизация без email`.
- **Ссылка на issue/PR** в конце строки: `(#257)`.
- **Дата релиза** — YYYY-MM-DD в заголовке версии.
- **Текущая версия** — верхняя запись, маркируется меткой «Текущая» в UI (в файле — просто первая).
- Каждая версия — отдельный релиз в git (`v1.3.50` тег + GitHub release).
- **Автообновление:** скрипт/CI обновляет CHANGELOG при создании релиза (аналог v1.3.47 NiksDesk). В Фазе 0 закладываем.

**Категории (в порядке убывания важности):**

1. `### Новые возможности`
2. `### Улучшения`
3. `### Исправления`
4. `### Изменения` (docs/refactor/chore — без заметного влияния)
5. `### Breaking changes` (если были — ставим первыми!)

**Где выводить:**

- Web-кабинет → страница `/changelog` (вёрстка как в скриншоте NiksDesk — карточки, версия + дата + badge «Текущая»).
- Mobile-parent → экран «О приложении → Что нового» с той же информацией.
- Версия приложения — всегда видна в sidebar web и на экране «О приложении» mobile.

## Команды (dev)

### Начальная установка

```bash
pnpm install              # JS/TS-зависимости
melos bootstrap           # Dart/Flutter-зависимости
```

### Docker-стек (Postgres + PostGIS, Redis, MinIO, Adminer)

```bash
pnpm stack:up             # поднять все сервисы
pnpm stack:down           # остановить (volumes сохраняются)
pnpm stack:reset          # остановить + удалить volumes (сброс БД!)
pnpm stack:logs           # следить за логами всех сервисов
pnpm stack:ps             # статус сервисов
```

Порты по умолчанию (`infra/docker/.env.dev.example`): Postgres `5432`, Redis `6379`, MinIO API `9000` / Console `9001`, Adminer `8080`.

**Если локальный порт занят** (например, на машине разработчика уже крутится свой PostgreSQL или другой docker-стек), переопределить порты в `infra/docker/.env.dev` и согласовать с `apps/backend/.env` (`DATABASE_URL`, `REDIS_URL`). Локальная dev-машина проекта использует `POSTGRES_PORT=54320`, `REDIS_PORT=63790`, `MINIO_API_PORT=9050`, `MINIO_CONSOLE_PORT=9051`.

### Приложения

```bash
pnpm dev                  # backend (3001) + web (3000) параллельно
pnpm build                # сборка всех JS/TS workspace-пакетов
pnpm test                 # Jest по всем пакетам
pnpm lint
pnpm typecheck

# Только backend
pnpm --filter @gmd/backend dev
pnpm --filter @gmd/backend prisma migrate dev --name <name>
pnpm --filter @gmd/backend prisma studio

# Mobile
cd apps/mobile-parent && flutter run
cd apps/mobile-child && flutter run
melos run analyze
```

### Healthchecks

- Backend liveness: http://localhost:3001/healthz
- Backend readiness: http://localhost:3001/readyz (проверяет БД + Redis)
- Web: http://localhost:3000/api/healthz

## Prod-деплой

Подробности: [docs/deploy.md](docs/deploy.md), [docs/backup-restore.md](docs/backup-restore.md), [docs/server-hardening.md](docs/server-hardening.md).

```bash
# Деплой актуального кода на gmd-prod (192.168.1.23)
bash infra/deploy/deploy.sh

# Проверки
curl http://192.168.1.23/api/readyz                 # {status:ok,db:up,redis:up}
ssh gmd-prod 'docker ps --format "{{.Names}} {{.Status}}"'

# Бэкапы PG (systemd timers)
ssh gmd-prod 'systemctl list-timers | grep pg-'
ssh gmd-prod 'ls /opt/gmd/backups/postgres/'
```

Сервер доступен по `http://192.168.1.23/` (внешний TLS — через nginx на 95.104.240.96, настраивается в Phase 0.4).

## Память и секреты

- Единственная система знаний — `mcp__memory-compiler__*`. Других vault'ов нет.
- `MC_ENCRYPT_KEY` — настроить, чтобы `save_secret` работал (сейчас credentials не шифруются).
- SSH/DB/API-ключи — только в `.env` и зашифрованно в memory-compiler.
- Никаких секретов в git.

## Язык

Общение на русском. Идентификаторы кода, API-названия — английский.
