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

# --- Phase 0.4: GlitchTip backup ---
GT_BACKUP_DIR=/opt/gmd/backups/glitchtip
mkdir -p "${GT_BACKUP_DIR}"
GT_FILE="${GT_BACKUP_DIR}/glitchtip-$(date -u +%Y-%m-%d).sql.gz"

docker exec -i gmd-glitchtip-postgres pg_dump -U glitchtip glitchtip \
  | gzip > "${GT_FILE}"

if [ ! -s "${GT_FILE}" ]; then
  echo "ERROR: GlitchTip backup is empty: ${GT_FILE}" >&2
  exit 1
fi

echo "GlitchTip backup OK: $(du -h "${GT_FILE}" | awk '{print $1}')"

# Retention 7 дней для GlitchTip
find "${GT_BACKUP_DIR}" -name 'glitchtip-*.sql.gz' -type f -mtime +7 -delete

# --- Phase 0.4: Heartbeat в Uptime Kuma ---
if [ -n "${KUMA_BACKUP_HEARTBEAT_URL:-}" ]; then
  curl -fsS --max-time 10 "${KUMA_BACKUP_HEARTBEAT_URL}&msg=OK" >/dev/null \
    || echo "WARN: Kuma heartbeat failed (non-fatal)"
fi

/opt/gmd/bin/pg-retention.sh
