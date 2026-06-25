# Перископ — мониторинг (Phase 0.4)

Два сервиса на prod-сервере `45.67.230.87` (periscop.pro, legacy API gmd-online.ru): **GlitchTip** (error tracking) и **Uptime Kuma** (uptime + алерты). Оба доступны только через SSH-туннель.

## Быстрый доступ

```bash
ssh -N gmd-online-tunnels &
# откроет:
# - http://localhost:3010 → GlitchTip
# - http://localhost:3011 → Uptime Kuma
# завершить: kill %1
```

Креды: memory-compiler → `save_secret` project `gmd`:

- `GlitchTip admin credentials`
- `Uptime Kuma admin credentials`
- `Telegram alerts bot @periscop_monitoring_bot`

## Что мониторим

| #   | Монитор (имя в Kuma)          | Критичность | Notification     |
| --- | ----------------------------- | ----------- | ---------------- |
| 1   | Caddy (вход, /healthz)        | warn        | Telegram         |
| 2   | Веб-сайт (/api/healthz)       | warn        | Telegram         |
| 3   | Бэкенд API (/api/readyz)      | critical    | Telegram + email |
| 4   | Контейнер PostgreSQL          | critical    | Telegram + email |
| 5   | Контейнер Redis               | critical    | Telegram + email |
| 6   | TLS-сертификат (periscop.pro) | warn        | Telegram (<14d)  |
| 7   | Свободное место на диске      | warn        | Telegram (push)  |
| 8   | Бэкап БД (ежедневный)         | critical    | Telegram + email |
| 9   | Контейнер бэкенда             | critical    | Telegram + email |

### Текст уведомлений

Формат сообщения в Kuma 1.23.x зашит в коде: `[<имя монитора>] [🔴 Down / ✅ Up]
<причина>`. Кастомные шаблоны (Liquid) появились только в Kuma 2.x. Поэтому
по-русски сделаны управляемые части: **имена мониторов** (см. таблицу) и **тексты
push-мониторов** #7/#8 (формируются скриптами `disk-heartbeat.sh` /
`pg-backup.sh`, кодируются через `curl -G --data-urlencode`). Обёртка
«🔴 Down / ✅ Up» и техническая `<причина>` (`200 - OK`, `connect ECONNREFUSED…`,
`healthy`) генерируются Kuma и остаются как есть — менять их можно только
кастомным образом (патч `monitor.js`) или апгрейдом до Kuma 2.x.

## Как отвечать на алерты

### Backend readyz down (Monitor #3)

1. Проверить `ssh gmd-online 'docker ps | grep gmd-backend'` — контейнер жив?
2. Если `Exited` → `docker logs gmd-backend --tail 100`.
3. Если `Up`, но readyz 503 — проверить БД/Redis:
   ```bash
   ssh gmd-online 'docker exec gmd-backend wget -qO- http://localhost:3001/readyz'
   ```
4. Перезапуск: `ssh gmd-online 'docker restart gmd-backend'`.
5. Если не помогло — см. GlitchTip (project `backend`) за свежими 5xx.

### Postgres container down (Monitor #4)

1. `ssh gmd-online 'docker logs gmd-postgres --tail 100'`.
2. Типичная причина: OOM → swap full → `dmesg | tail`.
3. Восстановление: `docker start gmd-postgres`, ждать healthy.
4. Если не стартует — restore из бэкапа (см. `docs/backup-restore.md`).

### Disk space warning (Monitor #7)

1. `ssh gmd-online 'df -h /opt/gmd/data'` — что занимает место?
2. Типичные причины:
   - GlitchTip-events раздулись → уменьшить `GLITCHTIP_EVENT_RETENTION_DAYS` в `.env.prod`
   - Старые дампы → проверить retention в `pg-backup.sh` и `kuma-backup.sh`
   - Postgres WAL → `docker exec gmd-postgres pg_archivecleanup …` (осторожно)

### PG backup heartbeat не пришёл > 36h (Monitor #8)

1. Проверить systemd-timer: `ssh gmd-online 'systemctl list-timers | grep backup'`.
2. Прогнать вручную: `ssh gmd-online '/opt/gmd/bin/pg-backup.sh'`.
3. Логи: `ssh gmd-online 'journalctl -u pg-backup.service --since "2 days ago"'`.

## Как добавить новый монитор

Открыть туннель, Kuma UI → `+ Add New Monitor` → заполнить → выбрать notification channel → Save. Новый монитор автоматически попадает в Dashboard.

## Настройка Telegram-бота

Бот `@gmd_khv_bot` (создан в Task 17 Phase 0.4). Токен и chat_id — в `/opt/gmd/.env.prod` и memory-compiler.

Добавить нового получателя алертов:

1. Новый admin пишет в @BotFather: узнаёт свой chat_id через `@userinfobot`.
2. Kuma UI → Settings → Notifications → Setup → Telegram с другим chat_id.
3. Привязать к мониторам.

## Sentry integration

### Backend (NestJS)

- Init в `apps/backend/src/main.ts` (до `NestFactory.create`).
- `SentryModule.forRoot()` из `@sentry/nestjs/setup` в `AppModule`.
- `beforeSend` вычищает ПДн (`scrub-pii.ts`) и фильтрует 4xx/validation/zod-ошибки.
- DSN: `SENTRY_DSN_BACKEND` в `.env.prod` (`http://…@glitchtip-web:8000/1`).

### Web (Next.js)

- Три config-файла: `sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`.
- Client-side шлёт события через `/api/sentry-tunnel` (own route, проксирует на `http://glitchtip-web:8000/api/<pid>/envelope/`) — это обходит недоступность docker-сети из браузера.
- DSN build-time: `NEXT_PUBLIC_SENTRY_DSN`; runtime server: `SENTRY_DSN_WEB`.

### Как добавить новое приложение

1. В GlitchTip UI создать новый project.
2. Скопировать DSN, заменить `localhost:3010` на `glitchtip-web:8000`, положить в `.env.prod`.
3. В приложении инициализировать Sentry SDK с этим DSN + `beforeSend` со scrub-pii.

## Troubleshooting

### GlitchTip не принимает события

- `docker logs gmd-glitchtip-web --tail 50` — ищем `400` или `ECONN*`.
- Проверить worker жив: `docker ps | grep glitchtip-worker`.
- DSN в `.env.prod` совпадает с тем, что в GlitchTip UI в project-settings.

### Kuma docker-монитор показывает down при живом контейнере

- Проверить, что `/var/run/docker.sock:ro` смонтирован: `docker inspect gmd-uptime-kuma | grep docker.sock`.
- Если нет — поправить compose и redeploy.

### Алерт не приходит в Telegram

- Проверить бота: `curl -s "https://api.telegram.org/bot$TOKEN/getMe"` — `{"ok":true}`.
- Проверить chat_id: `curl -s "https://api.telegram.org/bot$TOKEN/getUpdates"`.
- Бот заблокирован пользователем → `/start` в чате с ботом.
- **Тестировать egress ИЗНУТРИ контейнера Kuma, не с хоста** (сеть может
  отличаться). Креды лежат в `notification.config` под ключами
  `telegramBotToken` / `telegramChatID` (НЕ `botToken`/`chatID`!):
  `TOKEN=$(docker exec gmd-uptime-kuma sqlite3 /app/data/kuma.db "SELECT config FROM notification WHERE id=1;" | grep -oP '"telegramBotToken":"\K[^"]+')`
  → `docker exec -e TOK="$TOKEN" gmd-uptime-kuma node -e '...https.request api.telegram.org /bot$TOK/sendMessage...'`.
- **Kuma логирует только СБОИ отправки** (`[MONITOR] ERROR: Cannot send
notification to <name>`), успехи — молча. Отсутствие этой строки рядом с
  DOWN-переходом (`heartbeat.important=1`) = алерт ушёл.
- **Сквозной тест алерта** (item 4 detection-gap): временный http-монитор на
  `http://127.0.0.1:9/` (ECONNREFUSED), `maxretries=0` → мгновенный DOWN →
  убедиться что нет `Cannot send` → удалить монитор (`DELETE FROM heartbeat/
monitor_notification/monitor WHERE [monitor_]id=N`) + рестарт Kuma.

## Восстановление после миграции (инцидент 2026-06-01, task #72)

Миграция на новый сервер (2026-05-15, task #67) — домен перехоз с gmd-online.ru на periscop.pro,
**не перенесла** операционку мониторинга. Обнаружено через 2 дня после аутажа Redis (#71), который мониторинг
проспал. Чек-лист на будущее при переезде:

1. **URL HTTP-мониторов** в Uptime Kuma остались на старом домене
   `gmd-online.ru` → после переезда на periscop.pro DOWN с `ECONNREFUSED`. Так как они уже
   были DOWN, реальный аутаж не дал смены статуса UP→DOWN → **алерт не сработал**
   (Kuma шлёт только на смену статуса). **Сломанный монитор маскирует реальный
   сбой.** Фикс: `UPDATE monitor SET url=replace(url,'gmd-online.ru','periscop.pro')` (Kuma
   остановить → throwaway `sqlite3` на volume → старт).
2. **Из контейнера Kuma `periscop.pro` резолвится в `127.0.1.1`** (hostname
   сервера в /etc/hosts) → `ECONNREFUSED 127.0.1.1:443`. Фикс: в compose у
   `gmd-uptime-kuma` добавлен `extra_hosts: ['periscop.pro:45.67.230.87']`. Hairpin
   на прямой публичный IP (ens3, без NAT) работает.
3. **Бэкапы PG не делались 17 дней** — не было `/opt/gmd/bin`, таймеров, дампов.
   Фикс: `infra/server-setup/40-backups-install.sh` (копировать в `/root/gmd-setup`
   → запустить). Ставит `pg-backup` (03:15), `kuma-backup` (03:30),
   `pg-restore-verify` (вс). **Баг скрипта:** `. /opt/gmd/.env.prod` под `set -u`
   падает на bcrypt-хешах (`$2y$...` → `$2: unbound`). Исправлено: source с
   временно выключенным `nounset`.
4. **Push-источники** (#7 диск, #8 pg-backup heartbeat) — `infra/server/bin/
disk-heartbeat.sh` + systemd; push-токены из Kuma (`monitor.push_token`) в
   `/etc/default/gmd-disk-heartbeat` (#7) и `KUMA_BACKUP_HEARTBEAT_URL` в
   `.env.prod` (#8). URL: `http://localhost:3001/api/push/<token>`.
5. Добавлен docker-монитор `gmd-backend container` (#9) — раньше backend на
   уровне контейнера не мониторился.

После любого переезда: прогнать `systemctl list-timers | grep -E 'pg-backup|kuma'`,
проверить `/opt/gmd/backups/postgres` непустой, и что все мониторы Kuma зелёные
(а не «давно DOWN»).

## Ссылки

- Spec: [superpowers/specs/2026-04-19-gmd-phase0.4-monitoring-design.md](superpowers/specs/2026-04-19-gmd-phase0.4-monitoring-design.md)
- Plan: [superpowers/plans/2026-04-19-gmd-phase0.4-monitoring.md](superpowers/plans/2026-04-19-gmd-phase0.4-monitoring.md)
- [deploy.md](deploy.md), [backup-restore.md](backup-restore.md), [server-hardening.md](server-hardening.md)
