#!/usr/bin/env bash
# Снимает pg_dump -Fc из контейнера postgres, сжимает zstd, кладёт в /opt/gmd/backups/postgres/.
set -euo pipefail
umask 077

BACKUP_DIR=/opt/gmd/backups/postgres
DATE=$(date -u +%Y-%m-%d_%H%M)
FILE="${BACKUP_DIR}/gmd-${DATE}.dump"
LOCK=/var/lock/gmd-pg-backup.lock

mkdir -p "${BACKUP_DIR}"

exec 9>"$LOCK"
flock -n 9 || { echo "Another backup in progress; exiting."; exit 0; }

# Загружаем пароль из .env.prod
set -a; . /opt/gmd/.env.prod; set +a

docker exec -i gmd-postgres pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc -Z0 > "${FILE}"

zstd -19 --rm -q "${FILE}"
# Итог: gmd-YYYY-MM-DD_HHMM.dump.zst

SHA=$(sha256sum "${FILE}.zst" | awk '{print $1}')
echo "${SHA}  $(basename "${FILE}".zst)" >> "${BACKUP_DIR}/SHA256SUMS"

# Первый бэкап месяца — помечаем как monthly
DAY_OF_MONTH=$(date -u +%d)
if [ "${DAY_OF_MONTH}" = "01" ]; then
  ln "${FILE}.zst" "${BACKUP_DIR}/monthly-$(date -u +%Y-%m).dump.zst"
fi

echo "Backup OK: ${FILE}.zst ($(du -h "${FILE}".zst | awk '{print $1}'))"

/opt/gmd/bin/pg-retention.sh
