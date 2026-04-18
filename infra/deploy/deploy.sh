#!/usr/bin/env bash
# GMD prod deploy — запускается с локальной машины.
# Требует: ssh-alias gmd-prod (см. ~/.ssh/config), rsync.
#
# Структура на сервере:
#   /opt/gmd/docker/docker-compose.prod.yml  (compose-файл живёт здесь)
#   /opt/gmd/docker/postgres/*.sql           (init+retention)
#   /opt/gmd/caddy/Caddyfile
#   /opt/gmd/apps/{backend,web}              (исходники для build)
#   /opt/gmd/packages/*                      (shared workspace deps)
#   /opt/gmd/.env.prod                       (секреты, не трогаем)
#   /opt/gmd/data/*                          (persistent bind-mounts)
#
# Compose запускается из /opt/gmd/docker/, относительные пути (../caddy/Caddyfile,
# ./postgres/*.sql, ../apps/*) резолвятся корректно.
set -euo pipefail

SERVER="${GMD_SSH_ALIAS:-gmd-prod}"
REMOTE_DIR="/opt/gmd"
REMOTE_DOCKER="${REMOTE_DIR}/docker"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

say "1) rsync infra/docker + infra/caddy (compose и Caddyfile)"
rsync -avz --delete \
  --exclude '.env*' \
  --exclude 'data' \
  infra/docker/ "${SERVER}:${REMOTE_DOCKER}/"
rsync -avz --delete \
  infra/caddy/ "${SERVER}:${REMOTE_DIR}/caddy/"

say "2) rsync исходники backend + web + packages"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.turbo' \
  --exclude '*.log' \
  --exclude 'tsconfig.tsbuildinfo' \
  apps/backend/ "${SERVER}:${REMOTE_DIR}/apps/backend/"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.turbo' \
  --exclude '*.log' \
  --exclude 'tsconfig.tsbuildinfo' \
  apps/web/ "${SERVER}:${REMOTE_DIR}/apps/web/"
rsync -avz --delete \
  --exclude 'node_modules' \
  packages/ "${SERVER}:${REMOTE_DIR}/packages/"
rsync -avz \
  package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json \
  "${SERVER}:${REMOTE_DIR}/"

say "3) docker compose build + up -d (из /opt/gmd/docker/)"
ssh "${SERVER}" "cd ${REMOTE_DOCKER} && \
  docker compose --env-file ${REMOTE_DIR}/.env.prod -f docker-compose.prod.yml build --pull && \
  docker compose --env-file ${REMOTE_DIR}/.env.prod -f docker-compose.prod.yml up -d --remove-orphans"

say "4) Ждём healthy (polling, timeout 5 мин)"
ssh "${SERVER}" "cd ${REMOTE_DOCKER} && for i in \$(seq 1 60); do
  unhealthy=\$(docker compose -f docker-compose.prod.yml ps --format '{{.Service}} {{.Health}}' | awk '\$2!=\"healthy\" && \$2!=\"\" {print \$1}' | wc -l)
  starting=\$(docker compose -f docker-compose.prod.yml ps --format '{{.Service}} {{.Health}}' | awk '\$2==\"starting\" {print \$1}' | wc -l)
  if [ \"\$unhealthy\" = \"0\" ] && [ \"\$starting\" = \"0\" ]; then
    echo 'All services healthy'
    break
  fi
  echo \"[\${i}/60] waiting…\"
  sleep 5
done
docker compose -f docker-compose.prod.yml ps"

say "5) Prisma migrate deploy (ок если миграций ещё нет)"
ssh "${SERVER}" "cd ${REMOTE_DOCKER} && \
  docker compose --env-file ${REMOTE_DIR}/.env.prod -f docker-compose.prod.yml exec -T backend \
    node apps/backend/node_modules/.bin/prisma migrate deploy --schema apps/backend/prisma/schema.prisma" \
  || echo "(migrate skipped — normal for Phase 0.3; production migrations появятся в Phase 1)"

CADDY_DOMAIN=$(ssh "${SERVER}" "grep ^CADDY_DOMAIN ${REMOTE_DIR}/.env.prod | cut -d= -f2")
say "Done. Проверь https://${CADDY_DOMAIN}/healthz"
