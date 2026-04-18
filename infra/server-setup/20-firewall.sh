#!/usr/bin/env bash
# GMD — UFW + fail2ban.
# Порты наружу: 22 (SSH), 80/443 (Caddy). Всё остальное — deny.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq ufw fail2ban

# UFW: reset → deny incoming, allow outgoing, открыть 22/80/443
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment 'SSH'
ufw allow 80/tcp  comment 'HTTP (Caddy ACME)'
ufw allow 443/tcp comment 'HTTPS (Caddy)'
ufw --force enable
ufw status verbose

# fail2ban: jail для sshd (бэкенд systemd — ubuntu 24.04)
cat > /etc/fail2ban/jail.d/gmd-sshd.conf <<'EOF'
[sshd]
enabled  = true
port     = ssh
maxretry = 3
bantime  = 1h
findtime = 10m
backend  = systemd
EOF

systemctl enable --now fail2ban
systemctl restart fail2ban
sleep 2
fail2ban-client status sshd || fail2ban-client status
