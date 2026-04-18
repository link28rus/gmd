#!/usr/bin/env bash
# Retention: 14 дневных + 12 месячных.
set -euo pipefail

BACKUP_DIR=/opt/gmd/backups/postgres

# Удаляем daily старше 14 дней (кроме monthly-*)
find "${BACKUP_DIR}" -name 'gmd-*.dump.zst' -type f -mtime +14 -delete

# Удаляем monthly старше 12 месяцев (365 дней)
find "${BACKUP_DIR}" -name 'monthly-*.dump.zst' -type f -mtime +365 -delete

echo "Retention applied. Files now: $(ls -1 "${BACKUP_DIR}"/*.dump.zst 2>/dev/null | wc -l)"
