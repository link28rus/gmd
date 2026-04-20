#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/gmd/bin
install -m 0755 /root/gmd-setup/scripts/pg-backup.sh          /opt/gmd/bin/
install -m 0755 /root/gmd-setup/scripts/pg-restore-verify.sh  /opt/gmd/bin/
install -m 0755 /root/gmd-setup/scripts/pg-retention.sh       /opt/gmd/bin/
install -m 0755 /root/gmd-setup/scripts/kuma-backup.sh        /opt/gmd/bin/

install -m 0644 /root/gmd-setup/systemd/pg-backup.service         /etc/systemd/system/
install -m 0644 /root/gmd-setup/systemd/pg-backup.timer           /etc/systemd/system/
install -m 0644 /root/gmd-setup/systemd/pg-restore-verify.service /etc/systemd/system/
install -m 0644 /root/gmd-setup/systemd/pg-restore-verify.timer   /etc/systemd/system/
install -m 0644 /root/gmd-setup/systemd/kuma-backup.service       /etc/systemd/system/
install -m 0644 /root/gmd-setup/systemd/kuma-backup.timer         /etc/systemd/system/

# zstd для сжатия бэкапов
if ! command -v zstd >/dev/null 2>&1; then
  echo "==> Installing zstd…"
  apt-get update -qq
  apt-get install -y -qq zstd
fi

systemctl daemon-reload
systemctl enable --now pg-backup.timer pg-restore-verify.timer kuma-backup.timer
systemctl list-timers --no-pager | grep -E 'pg-backup|pg-restore' || true

# Первый прогон руками для дыма
echo "==> Running first pg-backup manually…"
systemctl start pg-backup.service
sleep 5
ls -la /opt/gmd/backups/postgres/ || true
journalctl -u pg-backup.service --no-pager | tail -20
