---
name: gmd-docker-ops
description: Use when working with Docker Compose services for GMD — inspecting logs, restarting/rebuilding a single service, checking container health, cleaning up volumes/images, execing into containers, or running prisma migrations. Covers both local dev stack (`infra/docker/docker-compose.dev.yml`) and production at gmd-prod (192.168.1.23, `/opt/gmd`). Trigger when the user asks about docker logs, compose, restart, healthcheck, или нужно зайти в контейнер.
---

# Docker Ops — GMD

Single source of truth for every Docker action on GMD. Use instead of typing raw `docker compose` commands from memory — local and production differ in compose file, env-file path, and ssh wrapping. Mistakes here lose data.

## Stack Topology

### Local dev (`infra/docker/docker-compose.dev.yml`, project name `gmd-dev`)

Запускается через `pnpm stack:up`. Backend и web в dev НЕ в docker — крутятся напрямую через `pnpm dev` для hot-reload.

| Service       | Container          | Port (host)                         | Purpose                                                       |
| ------------- | ------------------ | ----------------------------------- | ------------------------------------------------------------- |
| `postgres`    | `gmd-postgres-dev` | **54320**                           | PostgreSQL 16 + PostGIS 3.4 + pg_cron (для retention локаций) |
| `redis`       | `gmd-redis-dev`    | **63790**                           | Cache, rate-limit, queues                                     |
| `minio`       | `gmd-minio-dev`    | **9050** (API) / **9051** (console) | S3-совместимое хранилище (audio dumps от sound-around)        |
| `minio-setup` | one-shot           | —                                   | Создаёт bucket `gmd-uploads`, выходит                         |
| `adminer`     | `gmd-adminer-dev`  | **8080**                            | Web-UI для PostgreSQL (опционально)                           |
| `mailhog`     | `gmd-mailhog-dev`  | **8025** (UI) / **1025** (SMTP)     | Перехват dev-emails (OTP при регистрации)                     |

> **Нестандартные порты** — это намеренно (CLAUDE.md «Локальное окружение»). Если разработчик уже держит свой `postgres:5432` или другой dev-стек — конфликта нет. Соответствует `apps/backend/.env`: `DATABASE_URL=postgresql://gmd:gmd_dev_password@localhost:54320/gmd_dev`.

### Production (`infra/docker/docker-compose.prod.yml`, project name `gmd`)

Полный стек с приложениями + reverse proxy. Запускается через `bash infra/deploy/deploy.sh` (см. `gmd-deploy` skill).

| Service                                                                      | Container         | Port           | Purpose                                            |
| ---------------------------------------------------------------------------- | ----------------- | -------------- | -------------------------------------------------- |
| `postgres`                                                                   | `gmd-postgres`    | internal       | Production DB                                      |
| `redis`                                                                      | `gmd-redis`       | internal       | Cache/rate-limit                                   |
| `minio`                                                                      | `gmd-minio`       | internal       | Object storage                                     |
| `backend`                                                                    | `gmd-backend`     | internal :3001 | NestJS API                                         |
| `web`                                                                        | `gmd-web`         | internal :3000 | Next.js (App Router)                               |
| `caddy`                                                                      | `gmd-caddy`       | **80/443**     | Reverse proxy + automatic HTTPS (gmd.link28rus.ru) |
| `glitchtip-postgres`, `glitchtip-redis`, `glitchtip-web`, `glitchtip-worker` | `gmd-glitchtip-*` | internal       | Self-hosted error monitoring                       |
| `uptime-kuma`                                                                | `gmd-uptime-kuma` | internal       | Self-hosted uptime monitoring                      |

GlitchTip и Uptime-Kuma доступны через SSH-туннель: `ssh -N gmd-prod-tunnels` (см. `~/.ssh/config`).

## Where to Run What

| Location   | Command prefix                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Local      | `cd D:/Project/GMD && docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev ...`  |
| Production | `ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml ...'` |

> **Local short-hands:** в `package.json` уже есть `pnpm stack:up`, `stack:down`, `stack:reset`, `stack:logs`, `stack:ps` — используй их когда нужен ВЕСЬ dev-стек. Для одного сервиса — длинная команда выше.

> **Prod ssh-alias:** `gmd-prod` → `non-root user@192.168.1.23` (см. `~/.ssh/config`). НЕ использовать `root@192.168.1.23` напрямую — root заходит через ssh-key, но сервер под user-режимом.

## Common Tasks

### 1. Inspect logs (most common)

```bash
# Local — tail live (один сервис)
docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev logs -f postgres

# Local — все сервисы из dev-стека
pnpm stack:logs

# Production — последние 200 строк backend
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml logs --tail=200 backend'

# Production — мульти-сервис grep
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml logs --tail=500 backend web caddy | grep -iE "error|fatal|panic"'
```

### 2. Restart ONE service (без rebuild)

Используй когда `.env` поменялся, но image тот же:

```bash
# Local
docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev restart postgres

# Production
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml restart backend'
```

### 3. Rebuild ONE service (после code change)

Production-only — local backend/web НЕ в docker.

```bash
# Production — backend после изменения кода
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d --build backend'

# Production — web (Next.js, .next baked in)
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d --build web'
```

> **Web rebuild дорогой** (~3-5 мин — npm install + next build). Если меняется только env-переменная вида `NEXT_PUBLIC_FOO` — нужен **именно rebuild**, не restart, потому что `NEXT_PUBLIC_*` инлайнятся в bundle во время `next build`.

### 4. Full stack up/down

```bash
# Local — старт всего dev-стека (postgres + redis + minio + adminer + mailhog)
pnpm stack:up
# или: docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev up -d

# Local — остановить, но volumes сохранить
pnpm stack:down

# Local — СБРОС БД (удаляет volumes, переподнимает чисто)
pnpm stack:reset
# Используй когда нужно начать с чистой схемы (потом prisma migrate dev)

# Production — НИКОГДА `down -v`! Это удалит prod БД и MinIO!
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml down'
# Up — через deploy.sh, не вручную
```

### 5. Exec into containers

```bash
# psql (local) — но проще через MCP `mcp__gmd-postgres__query` (read-only)
docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev exec postgres psql -U gmd -d gmd_dev

# psql (production) — для оперативных правок
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml exec postgres psql -U gmd -d gmd'

# redis-cli (local)
docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev exec redis redis-cli

# Backend shell (production debugging)
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml exec backend sh'

# Prisma migration на проде (deploy.sh уже это делает, но если вручную)
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml run --rm --no-deps --entrypoint sh backend -c "node apps/backend/node_modules/prisma/build/index.js migrate deploy --schema apps/backend/prisma/schema.prisma"'
```

### 6. Health / status

```bash
# Local
pnpm stack:ps
# или: docker compose -f infra/docker/docker-compose.dev.yml ps

# Production — все сервисы health
ssh gmd-prod 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"'

# Production — readiness check API
ssh gmd-prod 'curl -sS http://localhost:3001/healthz'   # liveness
ssh gmd-prod 'curl -sS http://localhost:3001/readyz'    # readiness {db:up, redis:up}

# Resource usage
docker stats   # local
ssh gmd-prod 'docker stats --no-stream'   # prod single-shot
```

### 7. Cleanup (local only — never prod)

```bash
# Безопасно: dangling images, остановленные контейнеры, неиспользуемые сети
docker system prune -f

# ОПАСНО: + volumes (только LOCAL!)
docker system prune -af --volumes

# Удалить один volume
docker volume rm gmd-dev_postgres_data
# но проще: pnpm stack:reset
```

## Critical Rules

1. **НИКОГДА `docker compose down -v` на проде** — стирает `postgres_data`, `minio_data`, `glitchtip-postgres-data`. Без бэкапа — не восстановишь.
2. **НИКОГДА `docker system prune --volumes` на проде** — то же самое.
3. **`.env` всегда мапится через `--env-file`** — для prod это `/opt/gmd/.env.prod`, для local `infra/docker/.env.dev`. Без `--env-file` compose не подставит `${POSTGRES_PASSWORD}` и т.д., контейнер упадёт.
4. **Compose-файл указывать явно** — `-f docker-compose.dev.yml` (или prod). Без `-f` compose ищет `compose.yaml` в текущем каталоге → не найдёт.
5. **Не путать local/prod команды** — всегда префикс `ssh gmd-prod '...'` для production. Алиасы → инциденты.
6. **Env var changes для backend/web на проде = rebuild, НЕ restart** — для `NEXT_PUBLIC_*` (инлайнятся в Next.js bundle на build) обязательно `--build`. Для серверных env (`DATABASE_URL`, `JWT_SECRET`) — `restart` хватит, потому что `.env.prod` маппится через `--env-file`.
7. **Не запускать full prod stack локально** — порты 80/443/postgres конфликтнут.
8. **Перед миграцией БД на проде — backup** (см. ⏳ `gmd-db-backup` skill в TODO).

## Common Mistakes

| Mistake                                                                  | Correct                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `docker compose down -v` на проде                                        | `docker compose down` (без `-v`) — оставит volumes                         |
| `docker compose restart backend` после code change на проде              | `docker compose up -d --build backend`                                     |
| `docker compose up -d --build` после edit `.env.prod`                    | `docker compose restart <service>` (если не `NEXT_PUBLIC_*`)               |
| Пропустил `--env-file`                                                   | `--env-file /opt/gmd/.env.prod` обязателен на проде                        |
| Пропустил `-f docker-compose.prod.yml`                                   | Compose ищет `compose.yaml` в `cwd` — на проде это ничего не найдёт        |
| `psql` локально без `-T` через docker exec                               | `docker compose exec -T postgres psql ...` (no TTY в скриптах)             |
| Запустил `pnpm stack:up` на ноуте, который уже держит свой postgres:5432 | GMD dev-стек на 54320, но проверь .env.dev — порт может быть переопределён |
| `flutter`-команды на mobile-\* трогают docker                            | Mobile приложения **не в docker** — Flutter работает напрямую на хосте     |
| `ssh root@192.168.1.23` напрямую                                         | Используй ssh-alias `gmd-prod` (non-root user, см. `~/.ssh/config`)        |

## Known Bugs / Quirks

### postgres «received fast shutdown request» при cold-start

**Симптом:** Docker Desktop только что стартанул → `pnpm stack:up` → `gmd-postgres-dev` в статусе `unhealthy`, в логах `database system is shut down` сразу после `database system is ready to accept connections`.

**Cause:** не до конца понятный timing-issue с pg_cron init или volume mount. Воспроизводится при первом запуске после холодного старта Docker Desktop.

**Fix:** одна команда `docker compose ... restart postgres` лечит. После рестарта pg_cron стартует нормально, healthcheck проходит за ~3 сек.

```bash
docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev restart postgres
sleep 5
docker inspect --format='{{.State.Health.Status}}' gmd-postgres-dev   # → healthy
```

## Compose File Drift Check

Если prod ведёт себя иначе чем local после деплоя — первая мысль, не разъехались ли compose-файлы:

```bash
ssh gmd-prod 'cat /opt/gmd/docker/docker-compose.prod.yml' | diff - infra/docker/docker-compose.prod.yml
```

Если drift — запускай `bash infra/deploy/deploy.sh` (он tar-pipe заливает `infra/docker` целиком).

## When Things Are Broken

1. `docker ps` — какой сервис unhealthy?
2. `docker compose logs --tail=200 <service>` — читай реальную ошибку
3. Если контейнер restart-loops: `docker inspect <container>` → look at `State.ExitCode` and `State.Error`
4. Если OOM: `docker stats` во время crash
5. Если port conflict (Windows): `netstat -ano | findstr :<port>` → kill PID
6. Если volume-mount issue на Windows: проверь Docker Desktop → Settings → Resources → File sharing → `D:/` отмечен
7. Backend crash в prod: GlitchTip через ssh-tunnel (`ssh -N gmd-prod-tunnels`) → http://localhost:8000/

## Related

- [gmd-deploy](../gmd-deploy/SKILL.md) — полный релизный flow на gmd-prod
- [docs/deploy.md](../../../docs/deploy.md) — деплой документация (ключ Яндекс-Геокодера и т.д.)
- [infra/deploy/deploy.sh](../../../infra/deploy/deploy.sh) — production deploy script (74 строки)
- [docs/backup-restore.md](../../../docs/backup-restore.md) — бэкап/restore PG (`/opt/gmd/backups/postgres/`)
- `pnpm stack:up` / `stack:down` / `stack:reset` / `stack:logs` / `stack:ps` — скрипты в root `package.json`
- `mcp__gmd-postgres__query` — read-only SQL к local `gmd_dev` без `docker exec` (см. `.mcp.json`)
- ⏳ `gmd-db-backup` skill (TODO) — pg_dump/restore с anonymize для dev
