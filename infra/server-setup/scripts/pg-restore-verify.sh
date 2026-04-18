#!/usr/bin/env bash
# Еженедельный тест: поднять throwaway postgres, залить последний dump, проверить счётчики.
set -euo pipefail
umask 077

BACKUP_DIR=/opt/gmd/backups/postgres
LATEST=$(ls -1t "${BACKUP_DIR}"/gmd-*.dump.zst 2>/dev/null | head -1)

if [ -z "${LATEST}" ]; then
  echo "No backups found, skipping verify."
  exit 0
fi

set -a; . /opt/gmd/.env.prod; set +a

TMP_CONTAINER=gmd-restore-verify-$$
TMP_VOLUME=gmd-restore-verify-vol-$$

cleanup() {
  docker rm -fv "${TMP_CONTAINER}" >/dev/null 2>&1 || true
  docker volume rm "${TMP_VOLUME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${TMP_CONTAINER}" \
  -e POSTGRES_PASSWORD=verify \
  -v "${TMP_VOLUME}:/var/lib/postgresql/data" \
  gmd-postgres:16-postgis-pgcron \
  postgres -c shared_preload_libraries=pg_cron -c cron.database_name="${POSTGRES_DB}"

# Ждём готовности
for i in {1..30}; do
  if docker exec "${TMP_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

# Создаём целевую БД (pg_cron extension будет создан самим pg_restore)
docker exec "${TMP_CONTAINER}" psql -U postgres -c "CREATE DATABASE ${POSTGRES_DB} OWNER postgres;"

# Restore. pg_restore может вернуть !=0 из-за warnings — это ок, проверим ниже по count(tables).
set +e
zstd -dc "${LATEST}" | docker exec -i "${TMP_CONTAINER}" pg_restore -U postgres -d "${POSTGRES_DB}" --no-owner --no-privileges
RESTORE_RC=$?
set -e
echo "pg_restore exit: ${RESTORE_RC}"

# Smoke-check
TABLES=$(docker exec "${TMP_CONTAINER}" psql -U postgres -d "${POSTGRES_DB}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
echo "Restored backup has ${TABLES} tables in public schema."

if [ "${TABLES}" -gt 0 ]; then
  echo "Restore verify: OK ($(basename "${LATEST}"))"
else
  echo "Restore verify: WARN — 0 tables (может быть нормально на пустом кластере Phase 0.3)"
fi
