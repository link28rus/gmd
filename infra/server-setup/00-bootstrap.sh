#!/usr/bin/env bash
# GMD prod bootstrap — запускать на свежей Ubuntu 24.04 от root.
# Идемпотентный: повторный запуск не ломает состояние.
set -euo pipefail

echo "==> apt update + full-upgrade"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get full-upgrade -yq
apt-get install -yq --no-install-recommends \
  ca-certificates curl gnupg lsb-release \
  htop iotop ncdu zstd jq rsync tree \
  cloud-guest-utils unattended-upgrades

echo "==> hostname -> gmd-prod"
hostnamectl set-hostname gmd-prod
if grep -q '^127.0.1.1' /etc/hosts; then
  sed -i 's/^127.0.1.1.*/127.0.1.1\tgmd-prod/' /etc/hosts
else
  printf '127.0.1.1\tgmd-prod\n' >> /etc/hosts
fi

echo "==> timezone -> Europe/Moscow"
timedatectl set-timezone Europe/Moscow

echo "==> swap 4G (если нет)"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> unattended-upgrades enabled"
dpkg-reconfigure -fnoninteractive unattended-upgrades

echo "==> bootstrap done"
