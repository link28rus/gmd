# GMD — мониторинг (Phase 0.4)

Два сервиса на prod-сервере `192.168.1.23`: **GlitchTip** (error tracking) и **Uptime Kuma** (uptime + алерты). Оба доступны только через SSH-туннель.

## Быстрый доступ

```bash
ssh -N gmd-prod-tunnels &
# откроет:
# - http://localhost:3010 → GlitchTip
# - http://localhost:3011 → Uptime Kuma
# завершить: kill %1
```

Креды: memory-compiler → `save_secret` project `gmd`:

- `GlitchTip admin credentials`
- `Uptime Kuma admin credentials`
- `Telegram alerts bot @gmd_alerts_bot`

## Что мониторим

| #   | Монитор                    | Критичность | Notification       |
| --- | -------------------------- | ----------- | ------------------ |
| 1   | Caddy edge (`/healthz`)    | warn        | Telegram           |
| 2   | Web healthz                | warn        | Telegram           |
| 3   | Backend readyz             | critical    | Telegram + email   |
| 4   | Postgres container         | critical    | Telegram + email   |
| 5   | Redis container            | critical    | Telegram + email   |
| 6   | TLS cert expiry            | warn        | Telegram (<14d)    |
| 7   | Disk space `/opt/gmd/data` | warn        | Telegram (push 5m) |
| 8   | PG backup heartbeat        | critical    | Telegram + email   |

## Как отвечать на алерты

### Backend readyz down (Monitor #3)

1. Проверить `ssh gmd-prod 'docker ps | grep gmd-backend'` — контейнер жив?
2. Если `Exited` → `docker logs gmd-backend --tail 100`.
3. Если `Up`, но readyz 503 — проверить БД/Redis:
   ```bash
   ssh gmd-prod 'docker exec gmd-backend wget -qO- http://localhost:3001/readyz'
   ```
4. Перезапуск: `ssh gmd-prod 'docker restart gmd-backend'`.
5. Если не помогло — см. GlitchTip (project `backend`) за свежими 5xx.

### Postgres container down (Monitor #4)

1. `ssh gmd-prod 'docker logs gmd-postgres --tail 100'`.
2. Типичная причина: OOM → swap full → `dmesg | tail`.
3. Восстановление: `docker start gmd-postgres`, ждать healthy.
4. Если не стартует — restore из бэкапа (см. `docs/backup-restore.md`).

### Disk space warning (Monitor #7)

1. `ssh gmd-prod 'df -h /opt/gmd/data'` — что занимает место?
2. Типичные причины:
   - GlitchTip-events раздулись → уменьшить `GLITCHTIP_EVENT_RETENTION_DAYS` в `.env.prod`
   - Старые дампы → проверить retention в `pg-backup.sh` и `kuma-backup.sh`
   - Postgres WAL → `docker exec gmd-postgres pg_archivecleanup …` (осторожно)

### PG backup heartbeat не пришёл > 36h (Monitor #8)

1. Проверить systemd-timer: `ssh gmd-prod 'systemctl list-timers | grep backup'`.
2. Прогнать вручную: `ssh gmd-prod '/opt/gmd/bin/pg-backup.sh'`.
3. Логи: `ssh gmd-prod 'journalctl -u pg-backup.service --since "2 days ago"'`.

## Как добавить новый монитор

Открыть туннель, Kuma UI → `+ Add New Monitor` → заполнить → выбрать notification channel → Save. Новый монитор автоматически попадает в Dashboard.

## Настройка Telegram-бота

Бот `@gmd_alerts_bot` (создан в Task 17 Phase 0.4). Токен и chat_id — в `/opt/gmd/.env.prod` и memory-compiler.

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

## Ссылки

- Spec: [superpowers/specs/2026-04-19-gmd-phase0.4-monitoring-design.md](superpowers/specs/2026-04-19-gmd-phase0.4-monitoring-design.md)
- Plan: [superpowers/plans/2026-04-19-gmd-phase0.4-monitoring.md](superpowers/plans/2026-04-19-gmd-phase0.4-monitoring.md)
- [deploy.md](deploy.md), [backup-restore.md](backup-restore.md), [server-hardening.md](server-hardening.md)
