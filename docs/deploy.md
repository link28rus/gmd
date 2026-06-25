# Перископ — prod-деплой

Runbook по развёртыванию production-стека Перископ на VPS `45.67.230.87`
(periscop.pro, Ubuntu 24.04 LTS, single iface ens3). Legacy API-зеркало доступно на gmd-online.ru.

## Архитектура

```
Пользователь → 45.67.230.87:{80,443} → [Caddy + Let's Encrypt автоматически]
                                            ├── /api/* → backend:3001 (NestJS)
                                            ├── /audio/ws → backend:3001 (WS)
                                            └── /*     → web:3000     (Next.js)

Внутри docker-сети gmd_net:
  postgres:5432              (основная БД, Postgres 16 + PostGIS + pg_cron)
  redis:6379                 (основной Redis)
  minio:9000                 (audio chunks + avatars)
  backend:3001               (NestJS REST + /audio/ws)
  web:3000                   (Next.js 15 SSR)
  caddy:80/443               (reverse proxy + Let's Encrypt)
  glitchtip-postgres:5432    (GlitchTip — отдельная БД)
  glitchtip-redis:6379       (GlitchTip celery broker)
  glitchtip-web:8000         (error tracking UI + API)
  glitchtip-worker           (celery)
  uptime-kuma:3001           (uptime + алерты)

UFW: только 22/80/443 наружу. Админ-панели GlitchTip/Kuma —
через SSH-туннель (см. docs/monitoring.md).
```

## Prerequisites

- `ssh gmd-online 'echo ok'` возвращает `ok` (ключ в `~/.ssh/config` — см. Task 5 Phase 0.3).
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
3. `docker compose exec gmd-backend pnpm --filter @periscop/backend prisma migrate deploy`.
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
ssh gmd-online 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml down'
```

(историческая заметка: до 2026-05-15 сервис работал на domain gmd-online.ru; миграция на periscop.pro выполнена с сохранением инфра-имён как gmd-\* для стабильности текущих систем. Legacy API-редирект на gmd-online.ru остаётся активным.)

(В Phase 0.4 — реестр образов и deploy по тегу.)

## Проверки после deploy

```bash
# На dev-машине
curl -sS https://periscop.pro/healthz           # Caddy (TODO: directive order)
curl -sS https://periscop.pro/api/readyz        # backend → {"status":"ok","db":"up","redis":"up"}
curl -sSI https://periscop.pro/                 # web → HTTP/1.1 200 OK

# На сервере
ssh gmd-online 'docker ps --format "table {{.Names}}\t{{.Status}}"'
```

Ожидаем 6+ контейнеров в `Up (healthy)`: `gmd-postgres`, `gmd-redis`, `gmd-minio`, `gmd-backend`, `gmd-web`, `gmd-caddy`.

## Мониторинг

После деплоя stack включает GlitchTip (error tracking) и Uptime Kuma (uptime). Доступ: `ssh -N gmd-online-tunnels` → `http://localhost:3010` и `http://localhost:3011`. Детали — [docs/monitoring.md](monitoring.md).

## «Звук вокруг» — WebSocket-relay (v0.35)

В v0.35 «Звук вокруг» переведён с WebRTC/coturn на серверный WebSocket-relay.
coturn полностью удалён из стека (Phase 4 Plan E pivot, см. CHANGELOG v0.35.0-rc.4).

Backend поднимает WS-эндпоинт на `/audio/ws` (тот же 3001-порт, что и REST API).
Caddy уже проксирует `/audio/ws` через `reverse_proxy` (HTTP/1.1 Upgrade).

### Переменные окружения

```
AUDIO_WS_SECRET=<openssl rand -base64 48>  # ≥32 байт, JWT HS256-ключ
AUDIO_WS_PUBLIC_URL=wss://gmd-online.ru/audio/ws
```

Записать в `/opt/gmd/.env.prod`. Не коммитить.

## Обновление `.env.prod`

Редактируется только на сервере (в git не коммитится):

```bash
ssh gmd-online 'sudo -e /opt/gmd/.env.prod'
ssh gmd-online 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d'
```

Если меняем `NEXT_PUBLIC_*` — обязательно `--build web` (переменная запекается в bundle на этапе build).

## Troubleshooting

### `docker compose build` OOM

Swap 4G должен хватить для node-builder. Если всё ещё OOM — увеличить VM RAM или уменьшить `nproc`.

### `pg_isready` не становится healthy

```bash
ssh gmd-online 'docker logs gmd-postgres --tail 50'
```

Частая причина первого запуска — долгое создание PostGIS-расширений (2–3 минуты).

### Prisma `migrate deploy` fails: database not reachable

`docker ps` должен показывать `gmd-postgres` как `healthy`. Если нет — см. выше.

### Caddy не видит переменную из `.env.prod`

`docker compose exec caddy env | grep <VAR>` покажет что фактически пришло в контейнер. Значения с `$` проходят корректно через `--env-file`.

### Next.js показывает `NEXT_PUBLIC_API_URL` из предыдущего билда

`NEXT_PUBLIC_*` переменные запекаются на build-time. После изменения в `.env.prod` пересобрать:

```bash
ssh gmd-online 'cd /opt/gmd/docker && docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d --build gmd-web'
```

## Файлы

- `infra/deploy/deploy.sh` — сам скрипт.
- `infra/docker/docker-compose.prod.yml` — описание стека.
- `infra/caddy/Caddyfile` — конфиг reverse proxy (HTTP-режим).
- `infra/server-setup/*.sh` — одноразовые скрипты bootstrap/hardening (Tasks 2, 6, 7, 8, 15).
- `/opt/gmd/.env.prod` — секреты (на сервере, 600).
- `/opt/gmd/backups/postgres/` — ежедневные бэкапы PG (Task 15).

## Ключ Яндекс-Геокодера

Карты в кабинете рендерятся через OpenStreetMap (`react-leaflet`) — публичный ключ Яндекса для них **не нужен**. Но в редакторе геозон используется поиск по адресу через серверный `/api/geocode`, который ходит в **HTTP Геокодер Яндекса** (это отдельный продукт, отдельный лимит). Ключ нужен только для него; работает на server-side, в браузер не попадает.

Получить ключ:

1. Открыть https://developer.tech.yandex.ru
2. Войти под yandex-аккаунтом организации.
3. Создать API-ключ для **«HTTP Геокодер»** (JavaScript API не нужен).
4. В кабинете Яндекса ограничить ключ по HTTP Referer: `https://periscop.pro/*` (+ `http://localhost:3003/*` для dev).
5. Положить ключ в `apps/web/.env.local` (dev) или в prod `.env` через `infra/deploy/deploy.sh`:
   ```
   YANDEX_GEOCODER_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

Без ключа `/api/geocode` отвечает `503 geocoder_not_configured`, а в редакторе зон поиск по адресу показывает «поиск недоступен» — остальная функциональность (drag-маркеры, вёрстка зоны вручную) работает.
