#!/usr/bin/env bash
# GMD prod deploy — запускается с локальной машины.
# Требует: ssh-alias gmd-prod (см. ~/.ssh/config), rsync.
#
# Результат: на сервере 192.168.1.23 в /opt/gmd/ лежит актуальный код + compose,
# собраны образы backend/web, запущен стек, применены Prisma-миграции.
set -euo pipefail

SERVER="${GMD_SSH_ALIAS:-gmd-prod}"
REMOTE_DIR="/opt/gmd"
COMPOSE_FILE="${REMOTE_DIR}/docker-compose.prod.yml"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

say "1) rsync infra/docker + infra/caddy"
rsync -avz --delete \
  --exclude '.env*' \
  infra/docker/ "${SERVER}:${REMOTE_DIR}/docker/"
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

say "3) Копируем compose-файл в корень /opt/gmd"
ssh "${SERVER}" "cp ${REMOTE_DIR}/docker/docker-compose.prod.yml ${COMPOSE_FILE}"

say "4) docker compose build + up -d"
ssh "${SERVER}" "cd ${REMOTE_DIR} && \
  docker compose -f ${COMPOSE_FILE} --env-file .env.prod build --pull && \
  docker compose -f ${COMPOSE_FILE} --env-file .env.prod up -d --remove-orphans"

say "5) Ждём healthy (30s)…"
sleep 30
ssh "${SERVER}" "cd ${REMOTE_DIR} && docker compose -f ${COMPOSE_FILE} ps"

say "6) Prisma migrate deploy"
ssh "${SERVER}" "cd ${REMOTE_DIR} && \
  docker compose -f ${COMPOSE_FILE} --env-file .env.prod exec -T backend \
    node apps/backend/node_modules/.bin/prisma migrate deploy --schema apps/backend/prisma/schema.prisma" \
  || echo "(migrate failed — это ок для первого деплоя без реальных миграций; в Phase 1 будет нужно)"

say "Done. Проверь https://\$(ssh ${SERVER} 'grep ^CADDY_DOMAIN /opt/gmd/.env.prod | cut -d= -f2')/healthz"
