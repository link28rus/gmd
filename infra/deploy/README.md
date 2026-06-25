# Перископ prod deploy runbook

Цель: за одну команду задеплоить актуальный код на сервер (45.67.230.87).
SSH-алиас `gmd-online` и путь `/opt/gmd` — historical, остаются до отдельной
инфра-миграции (переименование пути/алиаса). Основной домен — `periscop.pro`.

## Prerequisites

- `ssh gmd-online 'echo ok'` → `ok` (ключ в `~/.ssh/config`, переход с
  `gmd-prod` выполнен в task #67 — миграция на новый VPS).
- `/opt/gmd/.env.prod` на сервере заполнен (см. `.env.prod.example`).
- DNS: `dig +short periscop.pro` → `45.67.230.87` (основной домен; `gmd-online.ru`
  тоже резолвится в этот IP — legacy-зеркало для старых mobile-приложений).
- UFW: открыты `22/80/443` (см. `infra/server-setup/`).

## Первый деплой

```bash
cd D:/Project/GMD
bash infra/deploy/deploy.sh
```

Первый раз собирает образы с нуля (5–15 минут на 2-ядерной VM).
Следующие вызовы — инкрементально (rsync + cached-build).

## Инкрементальный деплой

Тот же `bash infra/deploy/deploy.sh`. Скрипт идемпотентен.

## Rollback

```bash
ssh gmd-prod
cd /opt/gmd
docker compose -f docker-compose.prod.yml down
git -C /opt/gmd log  # если нужно (репо на сервере — в будущем)
# Или: на dev-машине git checkout <prev-sha>, затем снова deploy.sh
```

В Phase 0.4 — реестр образов и deploy по тегу.

## Troubleshooting

### Let's Encrypt: «too many requests»

Временно переключить Caddyfile на staging CA:

```caddy
{
    acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}
```

Пере-деплоить, получить stg-сертификат, убедиться что ACME работает, вернуть prod.

### `docker compose build` OOM

Swap 4G должен хватить для node-builder. Если всё ещё OOM — уменьшить `nproc` в builder или увеличить VM RAM.

### `pg_isready` не становится healthy

```bash
ssh gmd-prod 'docker compose -f /opt/gmd/docker-compose.prod.yml logs postgres'
```

Частая причина первого запуска — долгое создание PostGIS-расширений. Подождать 2-3 минуты.

### Prisma `migrate deploy` fails: database not reachable

Проверить `docker compose ps postgres` — должен быть `healthy`. Если нет — см. выше.

### Caddy не видит `CADDY_BASIC_AUTH_HASH`

Значение содержит `$`, которые `--env-file` интерпретирует корректно, но `docker compose config` их экранирует. Это только визуал — запущенный контейнер получает правильный хеш. Проверить: `docker compose exec caddy env | grep HASH`.

## Файлы

- `deploy.sh` — сам скрипт.
- `../docker/docker-compose.prod.yml` — описание стека.
- `../caddy/Caddyfile` — конфиг reverse proxy + TLS.
- `../server-setup/*.sh` — одноразовые скрипты bootstrap / hardening (Phase 0.3 Tasks 2, 6, 7, 8, 15).
