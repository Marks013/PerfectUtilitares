#!/usr/bin/env bash
set -euo pipefail

ROOT="$(realpath "${1:-.}")"
WEB="$ROOT/web"
NODE_IMAGE="${NODE_IMAGE:-node:24.19.0-alpine}"

if [[ ! -d "$ROOT/.git" || ! -f "$WEB/package.json" || ! -f "$WEB/package-lock.json" ]]; then
  echo "ERRO: repositório inválido: $ROOT" >&2
  exit 2
fi

node_compativel() {
  command -v node >/dev/null 2>&1 || return 1
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major === 24 && minor >= 19 ? 0 : 1);
  '
}

atualizar_no_host() {
  echo "Atualizando package-lock.json com $(node --version) / npm $(npm --version)..."
  (
    cd "$WEB"
    npm install --package-lock-only --ignore-scripts --no-audit --no-fund
  )
}

atualizar_no_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "ERRO: Node 24.19+ não está disponível e Docker não foi encontrado." >&2
    exit 3
  }
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  cp "$WEB/package.json" "$WEB/package-lock.json" "$tmp/"
  echo "Atualizando package-lock.json em $NODE_IMAGE..."
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e npm_config_cache=/tmp/.npm \
    -v "$tmp:/app" \
    -w /app \
    "$NODE_IMAGE" \
    sh -lc 'npm install --package-lock-only --ignore-scripts --no-audit --no-fund'
  cp "$tmp/package-lock.json" "$WEB/package-lock.json"
  rm -rf "$tmp"
  trap - RETURN
}

if node_compativel && command -v npm >/dev/null 2>&1; then
  atualizar_no_host
else
  atualizar_no_docker
fi

python3 - "$WEB/package.json" "$WEB/package-lock.json" <<'LOCKCHECK'
import json, sys
package_path, lock_path = sys.argv[1:]
package = json.load(open(package_path, encoding="utf-8"))
lock = json.load(open(lock_path, encoding="utf-8"))
root = lock.get("packages", {}).get("", {})
for section in ("dependencies", "devDependencies"):
    expected = package.get(section, {})
    actual = root.get(section, {})
    for name, version in expected.items():
        if actual.get(name) != version:
            raise SystemExit(
                f"ERRO: package-lock divergente para {name}: "
                f"esperado {version!r}, encontrado {actual.get(name)!r}"
            )
checks = {
    ("dependencies", "@prisma/client"): "7.9.1",
    ("dependencies", "@prisma/adapter-pg"): "7.9.1",
    ("dependencies", "pg"): "8.22.0",
    ("devDependencies", "prisma"): "7.9.1",
}
for (section, name), expected in checks.items():
    current = root.get(section, {}).get(name)
    if current != expected:
        raise SystemExit(f"ERRO: {name} no lock está {current!r}; esperado {expected!r}.")
print("OK: package-lock.json sincronizado com Prisma 7.")
LOCKCHECK

echo
printf 'Arquivos alterados após a atualização:\n'
git -C "$ROOT" status --short -- web/package.json web/package-lock.json
