# Changelog

Все значимые изменения проекта GMD фиксируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

Страница «Что нового» в web-кабинете рендерится из этого файла.

---

## [Unreleased]

### Новые возможности
- _здесь копятся фичи следующего релиза_

---

## v0.4.0 — 2026-04-18

### Новые возможности

- **Passwordless email-OTP вход** — регистрация и вход одним шагом через `/auth/request-otp` → `/auth/verify-otp` с 6-значным кодом; первая verify автоматически создаёт User + Family + Membership(owner)
- **JWT access + opaque refresh** — RS256 access 15m, 32-byte refresh 30d с rotation on use и replay detection (revoke всей цепочки при reuse)
- **Протектед endpoints** — `GET/PATCH /me`, `PATCH /family/:id` (owner-only), `DELETE /me` (soft-delete per 152-ФЗ) под `JwtAuthGuard`
- **Контекст семьи по умолчанию** — `GET /me` возвращает user + family + memberships одним запросом, не нужно 3 последовательных
- **Rate limiting через Redis** — `@nestjs/throttler` с кастомным `RedisThrottlerStorage`: OTP-request 3/10min, verify 10/10min, refresh/logout 30/min
- **MailHog в dev-стеке** — локальный SMTP + Web UI `http://localhost:8025`, OTP-письма видны в браузере
- **E2E на testcontainers** — 6 тестов на реальном Postgres (postgis/postgis:16-3.4) через `@testcontainers/postgresql`, полный auth-flow + replay detection + rate limit + delete account

### Улучшения

- **Единый формат ошибок** — `{ error: { code, message, details? } }` через глобальный `HttpExceptionFilter`
- **Zod DTO** — все входные endpoints валидируются `ZodValidationPipe`; детали ошибок — массив `{path, message}`
- **Enumeration defense** — `request-otp` всегда `202` + минимальная задержка 200ms против timing-attacks
- **OTP argon2id** — код хранится как argon2id hash + per-code salt, brute-force защищён счётчиком attempts (3 неудачные → код invalidate)
- **Refresh opaque + sha256** — в БД только sha256 от токена, утечка БД не даёт логин

### Изменения

- feat(auth): Prisma models `users`, `families`, `memberships`, `otp_codes`, `refresh_tokens` + миграция `auth_family`
- feat(common): `HttpExceptionFilter`, `ZodValidationPipe`, `RedisThrottlerStorage`
- feat(backend): модули `auth`, `users`, `family` с полным DI через `@Inject`
- chore(deps): `@nestjs/throttler`, `jose`, `@node-rs/argon2`, `nodemailer`, `zod`, `cookie-parser`, `testcontainers`, `@testcontainers/postgresql`
- chore(infra): MailHog в dev-стеке (`docker-compose.dev.yml`)
- chore(web): порт web-приложения 3000 → 3003 (конфликт с параллельным стеком на dev-машине)
- fix(auth): `@Body(ZodPipe)` вместо `@UsePipes` на методах с `@Param` — иначе Zod применяется к path-параметрам
- fix(auth): `@HttpCode(200)` на `verify-otp` и `refresh` (Nest default POST = 201)
- fix(smtp): dev `.env.example` использует `SMTP_HOST=127.0.0.1` — Windows резолвит `localhost` в IPv6, MailHog слушает IPv4

### Security

- **Refresh replay detection** — если клиент прислал уже-rotated token, сервер ревокает **всю цепочку** refresh-токенов этого userId
- **OTP одноразовый + auto-invalidate** — повторный `request-otp` на тот же email инвалидирует предыдущий активный код
- **JwtAuthGuard** — Bearer-only, clock-skew 30s, RS256 асимметричная подпись
- **152-ФЗ** — `acceptedPrivacyPolicyVersion` фиксируется при первой verify, `DELETE /me` → soft-delete + revoke refresh; hard-delete через 30 дней — отдельный cron-job (Phase 1.3)

---

## v0.3.0 — 2026-04-18

### Новые возможности

- **Production-стек на 192.168.1.23** — 6 docker-сервисов (postgres+PostGIS+pg_cron, redis, minio, backend NestJS, web Next.js 15, caddy) поднимаются одной командой `bash infra/deploy/deploy.sh`, все healthy
- **Ежедневные бэкапы БД + weekly restore-verify** — `pg_dump -Fc | zstd -19`, systemd-timer 03:15 MSK, retention 14 daily + 12 monthly, автоматическая проверка целостности в throwaway-контейнере по понедельникам 04:00
- **Автоматическая очистка локаций (152-ФЗ)** — `pg_cron` job `locations_retention_30d` в init-скрипте; реальный schedule активируется после первой Prisma-миграции Phase 1
- **Кастомный образ Postgres** — `gmd-postgres:16-postgis-pgcron` на базе `postgis/postgis:16-3.4` с установленным `postgresql-16-cron`

### Улучшения

- **SSH hardening** — отключена авторизация по паролю, root только по ключу (`PermitRootLogin prohibit-password`), alias `gmd-prod` в `~/.ssh/config`
- **UFW + fail2ban** — default deny incoming, allow 22/80/443; jail sshd с `maxretry=3, bantime=1h`
- **Docker CE + overlay2** — официальный docker.com repo, log-rotation 10MB × 3 в `/etc/docker/daemon.json`
- **Bootstrap-скрипт** — hostname `gmd-prod`, timezone `Europe/Moscow`, swap 4G, `unattended-upgrades`
- **Документация развёртывания** — [deploy.md](docs/deploy.md), [backup-restore.md](docs/backup-restore.md), [server-hardening.md](docs/server-hardening.md)

### Изменения

- feat(infra): Caddy переведён в HTTP-режим (`auto_https off`, site `:80`) — TLS будет терминировать внешний nginx на 95.104.240.96 (Phase 0.4)
- fix(infra): в `pg-restore-verify.sh` задан `cron.database_name=${POSTGRES_DB}`, иначе `CREATE EXTENSION pg_cron` падает при restore
- chore(infra): раздел `/dev/sda2` расширен с 20G до 80G (growpart + resize2fs)
- chore(infra): удалены старые сервисы `fk-norm` и `volleyball-attendance` с предварительным tar-бэкапом
- chore(infra): удалён native PostgreSQL 16 и Node.js (оставлены только контейнеризованные версии)

### Отложено на Phase 0.4

- GlitchTip self-hosted + Sentry SDK в backend/web — нужен внешний TLS и subdomain `errors.gmd.link28rus.ru`
- Uptime Kuma + мониторы — нужен внешний TLS и subdomain `status.gmd.link28rus.ru`
- Let's Encrypt на самом Caddy — сейчас TLS выпускается на внешнем nginx

---

## v0.2.0 — 2026-04-18

### Новые возможности
- **Docker dev-стек** — `pnpm stack:up` поднимает PostgreSQL 16 + PostGIS, Redis 7, MinIO, Adminer одной командой
- **Prisma-миграции работают** — первая миграция применена к живой БД, таблица `users` создана
- **Readiness-проба** — новый эндпоинт `GET /readyz` возвращает `{status, db, redis}` и реально пингует БД и Redis
- **PrismaService + RedisService** — NestJS-модули с lifecycle-хуками (`OnModuleInit` / `OnModuleDestroy`)
- **Bucket `gmd-uploads`** — создаётся автоматически one-shot `minio-setup` контейнером при старте стека

### Улучшения
- **Скрипты стека** — `stack:up/down/logs/ps/reset` в root `package.json`
- **Документация** — CLAUDE.md и README описывают dev-команды, порты и сценарий конфликтов портов

### Изменения
- chore(infra): docker-compose.prod.yml скелет с TODO (наполняется в Phase 0.3)
- chore(backend): `.env.example` обновлён (REDIS_URL + корректный пароль Postgres)
- fix(infra): minio переведён на `minio/minio` (bitnami/minio удалён с Docker Hub)
- fix(backend): `@Inject()` в HealthController, чтобы ESLint `consistent-type-imports` не превращал DI-провайдеры в `import type` и не ломал DI в рантайме

---

## v0.1.0 — 2026-04-18

### Изменения
- **Монорепо-скелет** — pnpm workspaces + Turborepo для JS/TS, Melos для Flutter
- **Backend** — NestJS 11 skeleton с `/healthz`, Prisma 5 (заглушечная модель User)
- **Web** — Next.js 15 skeleton с landing-заглушкой и `/api/healthz`
- **Mobile** — Flutter-приложения `mobile-parent` (Android+iOS) и `mobile-child` (Android); Dart-пакеты `gmd_parent`, `gmd_child`, `gmd_shared`
- **Пакеты** — `@gmd/shared-types`, `@gmd/ui` (заглушки)
- **Тулинг** — ESLint 9 flat config, Prettier 3, Husky 9 + lint-staged, commitlint (Conventional Commits)
- **fix(ui): `--no-error-on-unmatched-pattern`** — lint-скрипт пакета `@gmd/ui` не падает, если `src/**/*.tsx` пока пуст
- **Дизайн MVP** — см. [spec](docs/superpowers/specs/2026-04-18-gmd-mvp-design.md)
- **CLAUDE.md** — конвенции, скилы, субагенты, процесс

---

<!-- Шаблон записи релиза — раскомментировать при выпуске первой версии

## v0.1.0 — 2026-MM-DD

### Новые возможности
- **Название фичи** — человекочитаемое описание, что даёт пользователю (#PR)

### Улучшения
- **Короткое название** — что стало лучше (#PR)

### Исправления
- fix(scope): краткое описание починенного бага (#PR)

### Изменения
- docs: обновления документации
- refactor: техдолг без влияния на пользователя

-->
