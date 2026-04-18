# GMD — бэкапы и восстановление PostgreSQL

## Схема

| Что              | Когда                                | Где                                                      |
| ---------------- | ------------------------------------ | -------------------------------------------------------- |
| Daily dump       | `pg-backup.timer` — 03:15 MSK        | `/opt/gmd/backups/postgres/gmd-YYYY-MM-DD_HHMM.dump.zst` |
| Monthly hardlink | 1-го числа автоматически             | `/opt/gmd/backups/postgres/monthly-YYYY-MM.dump.zst`     |
| Restore-verify   | `pg-restore-verify.timer` — Пн 04:00 | throwaway контейнер + volume (создаётся/удаляется)       |
| SHA256           | при каждом бэкапе                    | `/opt/gmd/backups/postgres/SHA256SUMS`                   |

**Retention:** 14 daily + 12 monthly (старше — удаляется через `pg-retention.sh`).

**Формат:** `pg_dump -Fc -Z0` → `zstd -19` (custom format, максимальное сжатие).

## Проверить что бэкапы работают

```bash
ssh gmd-prod 'systemctl list-timers --no-pager | grep -E "pg-backup|pg-restore"'
```

Ожидаем две активные строки с `LEFT` > 0.

```bash
ssh gmd-prod 'ls -la /opt/gmd/backups/postgres/ && cat /opt/gmd/backups/postgres/SHA256SUMS'
```

Проверить лог последнего прогона:

```bash
ssh gmd-prod 'journalctl -u pg-backup.service --no-pager | tail -20'
ssh gmd-prod 'journalctl -u pg-restore-verify.service --no-pager | tail -30'
```

Ожидаемая строка в логе backup: `Backup OK: /opt/gmd/backups/postgres/gmd-…dump.zst (X K)`.
Ожидаемая строка в логе verify: `Restore verify: OK (…)` или `WARN — 0 tables` (если схема ещё пустая).

## Ручной прогон

```bash
ssh gmd-prod 'systemctl start pg-backup.service'
ssh gmd-prod 'systemctl start pg-restore-verify.service'
```

## Восстановление в prod (DANGEROUS)

**Перед восстановлением убедиться, что все приложения остановлены**, иначе получим конфликт с пишущими подключениями.

```bash
ssh gmd-prod
cd /opt/gmd/docker

# 1. Остановить потребителей БД
docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml stop backend web

# 2. Выбрать бэкап для восстановления
ls -lt /opt/gmd/backups/postgres/*.dump.zst | head
DUMP=/opt/gmd/backups/postgres/gmd-YYYY-MM-DD_HHMM.dump.zst

# 3. Drop/Create БД
source /opt/gmd/.env.prod
docker exec -i gmd-postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB} WITH (FORCE);" \
  -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};"

# 4. Restore
zstd -dc "$DUMP" | docker exec -i gmd-postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges

# 5. Запустить приложения
docker compose --env-file /opt/gmd/.env.prod -f docker-compose.prod.yml up -d backend web
```

## Восстановление в dev

Скопировать последний дамп с prod в dev-машину:

```bash
# С dev-машины
scp gmd-prod:/opt/gmd/backups/postgres/gmd-*.dump.zst ~/gmd-backup/
```

Восстановить в локальный docker Postgres (dev-стек):

```bash
DUMP=~/gmd-backup/gmd-2026-04-18_0315.dump.zst
zstd -dc "$DUMP" | docker exec -i gmd-postgres-dev \
  pg_restore -U gmd -d gmd --no-owner --no-privileges --clean --if-exists
```

**Важно:** перед использованием реальных prod-данных в dev —
прогнать anonymize-скрипт (обрезать PII, обнулить phones/emails).
Anonymize-скрипт будет добавлен в Phase 1 вместе с реальной схемой.

## Rollback стратегии по фазам

| Срок             | Метод                                       |
| ---------------- | ------------------------------------------- |
| Менее часа назад | Daily backup текущего дня                   |
| Менее 14 дней    | Daily-бэкап соответствующего дня            |
| 1–12 месяцев     | Monthly-hardlink `monthly-YYYY-MM.dump.zst` |
| Более 12 месяцев | Не поддерживается (retention)               |

## Устранение проблем

### `pg-restore-verify` упал с `can only create extension in database postgres`

Фикс применён в v0.3.0: throwaway контейнер запускается с `cron.database_name=${POSTGRES_DB}`, что разрешает pg_cron extension внутри целевой БД.

### Нет места на диске под бэкапы

Проверить:

```bash
ssh gmd-prod 'df -h /opt/gmd && du -sh /opt/gmd/backups/postgres'
```

Прогнать retention вручную:

```bash
ssh gmd-prod '/opt/gmd/bin/pg-retention.sh'
```

### SHA-файл расходится с реальностью

`SHA256SUMS` — append-only за весь период. Чтобы проверить текущие файлы:

```bash
ssh gmd-prod 'cd /opt/gmd/backups/postgres && sha256sum *.dump.zst'
```

Сравнить визуально с ожидаемыми строками.

## Файлы

- `infra/server-setup/scripts/pg-backup.sh`
- `infra/server-setup/scripts/pg-retention.sh`
- `infra/server-setup/scripts/pg-restore-verify.sh`
- `infra/server-setup/systemd/pg-backup.{service,timer}`
- `infra/server-setup/systemd/pg-restore-verify.{service,timer}`
- `infra/server-setup/40-backups-install.sh`
