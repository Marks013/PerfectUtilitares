#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:-}"
target_dir="${2:-/home/ubuntu/PerfectUtilitares/web}"
expected_target="/home/ubuntu/PerfectUtilitares/web"
expected_staging_root="/home/ubuntu/perfectutilitares-deploy"
access_env="/home/ubuntu/perfectutilitares-config/unimed/access.env"

if [[ -z "$source_dir" || ! -d "$source_dir" ]]; then
  echo "Uso: bash scripts/deploy-source-sync.sh <staging-dir> [$expected_target]" >&2
  exit 2
fi

source_dir="$(realpath "$source_dir")"
target_dir="$(realpath "$target_dir")"

if [[ "$target_dir" != "$expected_target" || "$source_dir" == "$target_dir" ]]; then
  echo "Origem ou destino de deploy inválido." >&2
  exit 2
fi

case "$source_dir/" in
  "$expected_staging_root/"*) ;;
  *)
    echo "Staging fora de $expected_staging_root." >&2
    exit 2
    ;;
esac

if [[ "$source_dir/" == "$target_dir/"* || "$target_dir/" == "$source_dir/"* ]]; then
  echo "Staging e destino não podem estar aninhados." >&2
  exit 2
fi

if [[ ! -f "$source_dir/package.json" || ! -f "$source_dir/docker-compose.yml" ]]; then
  echo "Staging não contém projeto web completo." >&2
  exit 2
fi

if [[ ! -f "$access_env" || "$(stat -c '%a' "$access_env")" != "600" ]]; then
  echo "Segredo Unimed ausente ou sem permissão 0600: $access_env" >&2
  exit 2
fi

rsync -a --delete-delay \
  --exclude='/.git/' \
  --exclude='/.env' \
  --exclude='/.env.local' \
  --exclude='/.env.production' \
  --exclude='/node_modules/' \
  --exclude='/storage/' \
  "$source_dir/" "$target_dir/"

echo "Fonte sincronizada: $source_dir -> $target_dir"
