#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SWAP_SIZE_GIB=${SWAP_SIZE_GIB:-8}

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Execute este instalador como root." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs
fi

if ! swapon --show=NAME --noheadings | grep -Fxq /swapfile; then
  if [ ! -f /swapfile ]; then
    fallocate -l "${SWAP_SIZE_GIB}G" /swapfile ||
      dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_SIZE_GIB * 1024)) status=progress
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi

if ! grep -Eq '^[[:space:]]*/swapfile[[:space:]]' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi

cat > /etc/sysctl.d/99-server-resource-protection.conf <<'SYSCTL'
vm.swappiness=10
vm.vfs_cache_pressure=50
SYSCTL
sysctl --system >/dev/null

install -m 0755 "$SCRIPT_DIR/server-resource-guard" /usr/local/sbin/server-resource-guard
if [ ! -f /etc/server-resource-guard.conf ]; then
  install -m 0644 "$SCRIPT_DIR/server-resource-guard.conf.example" /etc/server-resource-guard.conf
fi
install -m 0644 "$SCRIPT_DIR/server-resource-guard.service" /etc/systemd/system/server-resource-guard.service
install -m 0644 "$SCRIPT_DIR/server-resource-guard.timer" /etc/systemd/system/server-resource-guard.timer
install -m 0755 "$SCRIPT_DIR/perfectutilitares-maintenance" /usr/local/sbin/perfectutilitares-maintenance
install -m 0644 "$SCRIPT_DIR/perfectutilitares-maintenance.service" /etc/systemd/system/perfectutilitares-maintenance.service
install -m 0644 "$SCRIPT_DIR/perfectutilitares-maintenance.timer" /etc/systemd/system/perfectutilitares-maintenance.timer

mkdir -p /var/lib/server-resource-guard
chmod 755 /var/lib/server-resource-guard
systemctl daemon-reload
systemctl enable --now server-resource-guard.timer perfectutilitares-maintenance.timer
systemctl start server-resource-guard.service

printf '%s\n' "Protecao de recursos instalada."
