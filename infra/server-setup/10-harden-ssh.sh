#!/usr/bin/env bash
# GMD — hardening sshd.
# ВНИМАНИЕ: перед запуском проверить, что key-auth работает:
#   ssh -o PasswordAuthentication=no root@<host> 'echo ok' → ok
set -euo pipefail

CONF=/etc/ssh/sshd_config.d/99-gmd-hardening.conf
cat > "$CONF" <<'EOF'
# GMD hardening (overrides /etc/ssh/sshd_config and 50-cloud-init.conf)
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 20s
ClientAliveInterval 300
ClientAliveCountMax 2
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
Protocol 2
EOF

# Противоречие в 50-cloud-init.conf — выравниваем
if [ -f /etc/ssh/sshd_config.d/50-cloud-init.conf ] && \
   grep -q '^PasswordAuthentication yes' /etc/ssh/sshd_config.d/50-cloud-init.conf; then
  sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config.d/50-cloud-init.conf
fi

sshd -t
echo "==> sshd config OK. Restart sshd…"
systemctl restart ssh
systemctl --no-pager status ssh | head -5
