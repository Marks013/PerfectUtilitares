#!/usr/bin/env bash
set -euo pipefail

ROOT="$(realpath "${1:-.}")"
MODE="${2:-}"
WEB="$ROOT/web"
NODE_IMAGE="${NODE_IMAGE:-node:24.19.0-alpine}"

if [[ ! -d "$ROOT/.git" || ! -f "$WEB/package.json" ]]; then
  echo "ERRO: repositório inválido: $ROOT" >&2
  exit 2
fi

python3 "$ROOT/alteracao-prisma7/aplicar_prisma7.py" "$ROOT" --check

python3 - "$WEB/package.json" "$WEB/package-lock.json" "$WEB" <<'STATICCHECK'
import json, pathlib, re, sys
package_path, lock_path, web_path = sys.argv[1:]
web = pathlib.Path(web_path)
package = json.load(open(package_path, encoding="utf-8"))
lock = json.load(open(lock_path, encoding="utf-8"))
root = lock.get("packages", {}).get("", {})
for section in ("dependencies", "devDependencies"):
    for name, version in package.get(section, {}).items():
        current = root.get(section, {}).get(name)
        if current != version:
            raise SystemExit(
                f"ERRO: execute atualizar_lock_prisma7.sh; {name} está "
                f"{current!r} no lock e deveria estar {version!r}."
            )
expected = {
    ("dependencies", "@prisma/client"): "7.9.1",
    ("dependencies", "@prisma/adapter-pg"): "7.9.1",
    ("dependencies", "pg"): "8.22.0",
    ("devDependencies", "prisma"): "7.9.1",
}
for (section, name), version in expected.items():
    if package.get(section, {}).get(name) != version:
        raise SystemExit(f"ERRO: versão inesperada de {name} em package.json.")

schema = (web / "prisma/schema.prisma").read_text(encoding="utf-8")
if 'provider            = "prisma-client"' not in schema:
    raise SystemExit("ERRO: generator prisma-client não configurado.")
if 'output              = "../src/generated/prisma"' not in schema:
    raise SystemExit("ERRO: output do Prisma Client não configurado.")
if re.search(r'^\s*url\s*=\s*env\(', schema, re.MULTILINE):
    raise SystemExit("ERRO: DATABASE_URL ainda está no schema.prisma.")

generated_client = (web / "src/generated/prisma").resolve()

for root_dir in (web / "src", web / "prisma", web / "scripts"):
    for path in root_dir.rglob("*"):
        resolved = path.resolve()

        # O client gerado pelo Prisma pode importar módulos internos de
        # @prisma/client/runtime. Isso não é um import legado da aplicação.
        if generated_client == resolved or generated_client in resolved.parents:
            continue

        if path.is_file() and path.suffix in {".ts", ".tsx", ".mjs", ".js"}:
            text = path.read_text(encoding="utf-8")
            if "@prisma/client" in text:
                raise SystemExit(f"ERRO: import legado @prisma/client em {path}.")
            if "new PrismaClient()" in text:
                raise SystemExit(f"ERRO: PrismaClient sem adapter em {path}.")
print("OK: estrutura estática da migração Prisma 7 validada.")
STATICCHECK

node_compativel() {
  command -v node >/dev/null 2>&1 || return 1
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major === 24 && minor >= 19 ? 0 : 1);
  '
}

validar_no_host() {
  echo "Validando no host com $(node --version) / npm $(npm --version)..."
  (
    cd "$WEB"
    npm ci --no-audit --no-fund
    npm run prisma:generate
    npm run prisma:validate
    npm run typecheck
    npm test
    npm run quality:dead-code
  )
}

validar_no_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "ERRO: Node 24.19+ não está disponível e Docker não foi encontrado." >&2
    exit 3
  }
  echo "Validando em contêiner isolado $NODE_IMAGE..."
  docker run --rm \
    -e HOME=/tmp \
    -e NPM_CONFIG_UPDATE_NOTIFIER=false \
    -e NEXT_TELEMETRY_DISABLED=1 \
    -e npm_config_cache=/tmp/.npm \
    -v "$WEB:/app" \
    --mount type=volume,destination=/app/node_modules \
    -w /app \
    "$NODE_IMAGE" \
    sh -lc '
      apk add --no-cache libc6-compat openssl vips >/dev/null 2>&1 &&
      npm ci --no-audit --no-fund &&
      npm run prisma:generate &&
      npm run prisma:validate &&
      npm run typecheck &&
      npm test &&
      npm run quality:dead-code
    '
}

if node_compativel && command -v npm >/dev/null 2>&1; then
  validar_no_host
else
  validar_no_docker
fi

(
  cd "$WEB"
  docker compose config --quiet
  if [[ "$MODE" == "--build" ]]; then
    docker compose build migrate app pdf-worker
  fi
)

git -C "$ROOT" diff --check

echo
echo "Validação Prisma 7 concluída com sucesso."
