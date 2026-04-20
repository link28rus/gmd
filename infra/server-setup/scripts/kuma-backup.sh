#!/usr/bin/env bash
# Phase 0.4: ежедневный снапшот Uptime Kuma volume.
# Запускается systemd-таймером вместе с pg-backup (см. 40-backups-install.sh).

set -euo pipefail
umask 077

BACKUP_DIR=/opt/gmd/backups/uptime-kuma
DATA_DIR=/opt/gmd/data/uptime-kuma

mkdir -p "${BACKUP_DIR}"

BACKUP_FILE="${BACKUP_DIR}/kuma-$(date -u +%Y-%m-%d).tar.gz"

# Останавливаем контейнер на короткое время, чтобы sqlite не был в середине записи.
# EXIT-trap гарантирует, что контейнер поднимется даже при ошибке tar.
docker stop gmd-uptime-kuma >/dev/null
trap 'docker start gmd-uptime-kuma >/dev/null' EXIT

tar czf "${BACKUP_FILE}" -C /opt/gmd/data uptime-kuma

if [ ! -s "${BACKUP_FILE}" ]; then
  echo "ERROR: Kuma backup is empty" >&2
  exit 1
fi

echo "Kuma backup OK: $(du -h "${BACKUP_FILE}" | awk '{print $1}')"

# Retention 7 дней
find "${BACKUP_DIR}" -name 'kuma-*.tar.gz' -type f -mtime +7 -delete
