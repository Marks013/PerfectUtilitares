#!/usr/bin/env sh
set -eu

data_root="${PERFECTUTILITARES_DATA_ROOT:-/home/ubuntu/perfectutilitares-data}"
config_root="${PERFECTUTILITARES_CONFIG_ROOT:-/home/ubuntu/perfectutilitares-config}"
app_uid="${APP_UID:-1001}"
app_gid="${APP_GID:-1001}"
postgres_uid="${POSTGRES_UID:-999}"
postgres_gid="${POSTGRES_GID:-999}"

case "$data_root" in
  /home/ubuntu/*) ;;
  *) echo "PERFECTUTILITARES_DATA_ROOT deve ficar dentro de /home/ubuntu." >&2; exit 1 ;;
esac

case "$config_root" in
  /home/ubuntu/*) ;;
  *) echo "PERFECTUTILITARES_CONFIG_ROOT deve ficar dentro de /home/ubuntu." >&2; exit 1 ;;
esac

install -d -m 750 "$data_root/postgres"
install -d -m 750 "$data_root/pdf-jobs"
install -d -m 750 "$config_root/unimed/templates"

chown -R "$postgres_uid:$postgres_gid" "$data_root/postgres"
chown -R "$app_uid:$app_gid" "$data_root/pdf-jobs"
chown -R "$app_uid:$app_gid" "$config_root/unimed"

printf '%s\n' "Diretórios persistentes preparados:"
printf '  %s\n' "$data_root/postgres" "$data_root/pdf-jobs" "$config_root/unimed/templates"
