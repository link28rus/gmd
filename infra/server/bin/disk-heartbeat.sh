#!/usr/bin/env bash
# disk-heartbeat — отправляет в Uptime Kuma push-monitor «disk-space /opt/gmd/data»
# текущий процент использования root-раздела. Запускается systemd-timer'ом
# раз в 5 минут.
#
# Если использование > THRESHOLD_PCT — шлём status=down (Uptime Kuma уведомит).
# Иначе up + ping = use%.
#
# Конфиг через env (читается из /etc/default/gmd-disk-heartbeat):
#   KUMA_PUSH_URL   — обязательно. Полный URL вида http://localhost:3001/api/push/<TOKEN>
#   THRESHOLD_PCT   — опционально, default 90.
#   MOUNT           — опционально, default /opt/gmd/data.

set -euo pipefail

THRESHOLD_PCT="${THRESHOLD_PCT:-90}"
MOUNT="${MOUNT:-/opt/gmd/data}"

if [[ -z "${KUMA_PUSH_URL:-}" ]]; then
  echo "disk-heartbeat: KUMA_PUSH_URL not set" >&2
  exit 1
fi

# `df -P` — POSIX-формат, без переносов. Берём строку с реальным mount, не df-header.
read -r used_pct <<<"$(df -P "$MOUNT" 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"

if [[ -z "$used_pct" ]]; then
  echo "disk-heartbeat: failed to read disk usage for $MOUNT" >&2
  curl -fsS --max-time 10 "${KUMA_PUSH_URL}?status=down&msg=df-failed&ping=0" >/dev/null || true
  exit 2
fi

status="up"
if (( used_pct >= THRESHOLD_PCT )); then
  status="down"
fi

msg="${used_pct}%25%20used%20on%20${MOUNT//\//%2F}"
curl -fsS --max-time 10 "${KUMA_PUSH_URL}?status=${status}&msg=${msg}&ping=${used_pct}" >/dev/null
