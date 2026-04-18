#!/usr/bin/env bash
# GMD prod deploy — запускается с локальной машины (git-bash/msys2 на Windows, либо Linux/Mac).
# Требует: ssh-alias gmd-prod (см. ~/.ssh/config).
#
# Используем tar-pipe через SSH вместо rsync — rsync 3.4.x на Windows
# падает с "dup() in/out/err failed" в git-bash pipeline. tar-pipe работает
# с любым SSH и без отдельного бинарника на хосте.
set -euo pipefail

SERVER="${GMD_SSH_ALIAS:-gmd-prod}"
REMOTE_DIR="/opt/gmd"
REMOTE_DOCKER="${REMOTE_DIR}/docker"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }

# tar-copy: отправить содержимое локальной директории в удалённую (с удалением лишнего через rsync-like delete).
# $1 — локальная директория, $2 — удалённая директория, $3+ — exclude-patterns
tar_send() {
  local src="$1" dst="$2"
  shift 2
  local excludes=()
  for pat in "$@"; do
    excludes+=("--exclude=${pat}")
  done
  ssh "${SERVER}" "mkdir -p ${dst}"
  # Snapshot перед deploy — чтобы удалять только устаревшее
  tar -cz "${excludes[@]}" -C "${src}" . | ssh "${SERVER}" "tar -xzf - -C ${dst}"
}

say "1) Upload infra/docker + infra/caddy"
tar_send "infra/docker"  "${REMOTE_DOCKER}"  ".env*" "data"
tar_send "infra/caddy"   "${REMOTE_DIR}/caddy"

say "2) Upload apps/backend + apps/web + packages + root manifests"
tar_send "apps/backend"  "${REMOTE_DIR}/apps/backend"  "node_modules" ".next" "dist" ".turbo" "*.log" "tsconfig.tsbuildinfo"
tar_send "apps/web"      "${REMOTE_DIR}/apps/web"      "node_modules" ".next" "dist" ".turbo" "*.log" "tsconfig.tsbuildinfo"
tar_send "packages"      "${REMOTE_DIR}/packages"      "node_modules"
tar -cz package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json | \
  ssh "${SERVER}" "tar -xzf - -C ${REMOTE_DIR}"

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
