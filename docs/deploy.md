# GMD — prod-деплой

Runbook по развёртыванию production-стека GMD на сервере `192.168.1.23`.

## Архитектура (v0.3.0)

```
Пользователь → [внешний nginx 95.104.240.96, TLS] → … (в будущем)
                                                        ↓
                          [Caddy :80 на 192.168.1.23]
                             ├── /api/* → backend:3001 (NestJS)
                             └── /*     → web:3000     (Next.js)

Внутри docker-сети gmd_net:
  postgres:5432   (custom gmd-postgres:16-postgis-pgcron)
  redis:6379
  minio:9000
  backend:3001
  web:3000
  caddy:80
```

**Сейчас** сервис доступен только по `http://192.168.1.23/`.
Внешний TLS-фронт (nginx на 95.104.240.96) настраивается в Phase 0.4.

## Prerequisites

- `ssh gmd-prod 'echo ok'` возвращает `ok` (ключ в `~/.ssh/config` — см. Task 5 Phase 0.3).
- `/opt/gmd/.env.prod` на сервере заполнен (Task 9).
- Docker CE + compose-plugin установлены (Task 8).
- Образ `gmd-postgres:16-postgis-pgcron` существует на сервере (Task 10) либо собирается при первом deploy.

## Первый деплой

```bash
cd D:/Project/GMD
bash infra/deploy/deploy.sh
```

Первый раз собирает образы с нуля (5–15 минут на 2-ядерной VM + swap 4G).
Последующие вызовы — инкрементально (rsync + cached-build).

Скрипт `deploy.sh` делает:

1. `rsync` исходников (apps, packages, infra, root manifests) в `/opt/gmd/` на сервере.
2. `docker compose build` и `up -d` на сервере.
3. `docker compose exec backend pnpm --filter @gmd/backend prisma migrate deploy`.
4. `docker compose ps` для проверки, что все сервисы healthy.

## Инкрементальный деплой

Тот же `bash infra/deploy/deploy.sh`. Скрипт идемпотентен: rsync пропускает неизменённые файлы, compose использует cache.

## Rollback

На dev-машине:

```bash
git checkout <prev-sha>
bash infra/deploy/deploy.sh
```

Для выключения стека без rollback:

```bash
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml down'
```

(В Phase 0.4 — реестр образов и deploy по тегу.)

## Проверки после deploy

```bash
# На dev-машине
curl -sS http://192.168.1.23/healthz           # Caddy (TODO: directive order)
curl -sS http://192.168.1.23/api/readyz        # backend → {"status":"ok","db":"up","redis":"up"}
curl -sSI http://192.168.1.23/                 # web → HTTP/1.1 200 OK

# На сервере
ssh gmd-prod 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

Ожидаем 6 контейнеров в `Up (healthy)`: `gmd-postgres`, `gmd-redis`, `gmd-minio`, `gmd-backend`, `gmd-web`, `gmd-caddy`.

## Обновление `.env.prod`

Редактируется только на сервере (в git не коммитится):

```bash
ssh gmd-prod 'sudo -e /opt/gmd/.env.prod'
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d'
```

Если меняем `NEXT_PUBLIC_*` — обязательно `--build web` (переменная запекается в bundle на этапе build).

## Troubleshooting

### `docker compose build` OOM

Swap 4G должен хватить для node-builder. Если всё ещё OOM — увеличить VM RAM или уменьшить `nproc`.

### `pg_isready` не становится healthy

```bash
ssh gmd-prod 'docker logs gmd-postgres --tail 50'
```

Частая причина первого запуска — долгое создание PostGIS-расширений (2–3 минуты).

### Prisma `migrate deploy` fails: database not reachable

`docker ps` должен показывать `gmd-postgres` как `healthy`. Если нет — см. выше.

### Caddy не видит переменную из `.env.prod`

`docker compose exec caddy env | grep <VAR>` покажет что фактически пришло в контейнер. Значения с `$` проходят корректно через `--env-file`.

### Next.js показывает `NEXT_PUBLIC_API_URL` из предыдущего билда

`NEXT_PUBLIC_*` переменные запекаются на build-time. После изменения в `.env.prod` пересобрать:

```bash
ssh gmd-prod 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d --build web'
```

## Файлы

- `infra/deploy/deploy.sh` — сам скрипт.
- `infra/docker/docker-compose.prod.yml` — описание стека.
- `infra/caddy/Caddyfile` — конфиг reverse proxy (HTTP-режим).
- `infra/server-setup/*.sh` — одноразовые скрипты bootstrap/hardening (Tasks 2, 6, 7, 8, 15).
- `/opt/gmd/.env.prod` — секреты (на сервере, 600).
- `/opt/gmd/backups/postgres/` — ежедневные бэкапы PG (Task 15).
