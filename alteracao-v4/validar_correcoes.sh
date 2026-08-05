#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$ROOT" && pwd)"

python3 "$SCRIPT_DIR/aplicar_correcoes.py" --self-test
CHECK_OUTPUT="$(python3 "$SCRIPT_DIR/aplicar_correcoes.py" "$ROOT" --check)"
printf '%s\n' "$CHECK_OUTPUT"
if ! grep -q '^Validadas 0 alterações:' <<<"$CHECK_OUTPUT"; then
  echo "ERRO: ainda existem correções V4 pendentes. Execute --apply antes de validar." >&2
  exit 2
fi

git -C "$ROOT" diff --check

cd "$ROOT/web"
if ! node -e "require.resolve('nodemailer')" >/dev/null 2>&1; then
  echo "Instalando Nodemailer 8.0.11 somente no node_modules local (sem alterar npm ou package-lock)..."
  npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund nodemailer@8.0.11
fi

npm run typecheck
npm test

if [[ "${DOCKER_BUILD:-0}" == "1" ]]; then
  docker compose config --quiet
  docker compose build migrate app pdf-worker
fi

echo "Validação V4 concluída com sucesso."
