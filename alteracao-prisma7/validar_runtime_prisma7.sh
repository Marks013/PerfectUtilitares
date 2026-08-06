#!/usr/bin/env bash
set -euo pipefail

ROOT="$(realpath "${1:-.}")"
WEB="$ROOT/web"

if [[ ! -d "$ROOT/.git" || ! -f "$WEB/docker-compose.yml" ]]; then
  echo "ERRO: repositório inválido: $ROOT" >&2
  exit 2
fi

cd "$WEB"
docker compose up -d --wait db
docker compose build migrate
docker compose run --rm --no-deps migrate npm run prisma:smoke

echo
echo "Smoke de runtime Prisma 7 concluído com sucesso."
