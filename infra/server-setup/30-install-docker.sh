#!/usr/bin/env bash
# GMD — установка Docker CE по официальной инструкции docker.com.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# Убираем возможные старые версии из distro repo
apt-get remove -yq docker docker-engine docker.io containerd runc 2>/dev/null || true

# Официальный GPG-ключ
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi

# Репозиторий
codename=$(. /etc/os-release && echo "${VERSION_CODENAME}")
cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable
EOF

apt-get update -q
apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Daemon config — log rotation, overlay2, live-restore
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "storage-driver": "overlay2",
  "live-restore": true
}
EOF

systemctl enable --now docker
systemctl restart docker

docker version
docker compose version
