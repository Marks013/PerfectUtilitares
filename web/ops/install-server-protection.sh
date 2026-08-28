#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SWAP_SIZE_GIB=${SWAP_SIZE_GIB:-8}

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Execute este instalador como root." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1 ||
  ! command -v curl >/dev/null 2>&1 || ! command -v flock >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs jq curl util-linux
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
install -m 0755 "$SCRIPT_DIR/perfectutilitares-backup" /usr/local/sbin/perfectutilitares-backup
install -m 0755 "$SCRIPT_DIR/perfectutilitares-backup-verify" /usr/local/sbin/perfectutilitares-backup-verify
install -m 0755 "$SCRIPT_DIR/perfectutilitares-restore" /usr/local/sbin/perfectutilitares-restore
install -m 0755 "$SCRIPT_DIR/validate-observability-env.mjs" /usr/local/sbin/validate-perfectutilitares-observability
install -m 0644 "$SCRIPT_DIR/perfectutilitares-backup.service" /etc/systemd/system/perfectutilitares-backup.service
install -m 0644 "$SCRIPT_DIR/perfectutilitares-backup.timer" /etc/systemd/system/perfectutilitares-backup.timer
install -m 0644 "$SCRIPT_DIR/perfectutilitares-backup-verify.service" /etc/systemd/system/perfectutilitares-backup-verify.service
install -m 0644 "$SCRIPT_DIR/perfectutilitares-backup-verify.timer" /etc/systemd/system/perfectutilitares-backup-verify.timer
if [ ! -f /etc/perfectutilitares-backup.conf ]; then
  install -m 0600 "$SCRIPT_DIR/perfectutilitares-backup.conf.example" /etc/perfectutilitares-backup.conf
fi

mkdir -p /var/lib/server-resource-guard
chmod 755 /var/lib/server-resource-guard
mkdir -p /home/ubuntu/perfectutilitares-backups
chmod 700 /home/ubuntu/perfectutilitares-backups
systemctl daemon-reload
systemctl enable --now \
  server-resource-guard.timer \
  perfectutilitares-maintenance.timer \
  perfectutilitares-backup.timer \
  perfectutilitares-backup-verify.timer
systemctl start server-resource-guard.service

printf '%s\n' "Protecao de recursos instalada."
