#!/bin/bash
# Only a disposable ARM64 runner. Do not run on the shared production A1.
set -euo pipefail
test "$#" = 1 || exit 1
test "${CI:-}" = true && test "${ESCALAS_CROSS_ENGINE_ISOLATED:-}" = 1 && test "$(uname -m)" = aarch64
here=$(cd -- "$(dirname -- "$0")" && pwd -P)
mkdir -p -- "$1"
evidence=$(cd -- "$1" && pwd -P)
work=$(mktemp -d)
container="solverforge-smoke-$(cat /proc/sys/kernel/random/uuid)"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT
export CARGO_HOME="$work/cargo"
export CARGO_TERM_COLOR=never
export RAYON_NUM_THREADS=1
export CARGO_BUILD_JOBS=2
revision=78889c3ff9fda158c70e6a1f67f8c7f0fdae922e
lock_blob=8d748afc1df1702f11d247d471edea6fda9dc4f8
src="$work/source"
git init -q "$src"
git -C "$src" -c protocol.file.allow=never fetch --no-tags --depth=1 \
  https://github.com/SolverForge/solverforge.git refs/tags/v0.31.2
git -C "$src" checkout --detach --quiet FETCH_HEAD
test "$(git -C "$src" rev-parse HEAD)" = "$revision"
test "$(git -C "$src" hash-object Cargo.lock)" = "$lock_blob"
printf '%s\n' "$revision" > "$evidence/upstream-revision.txt"
cp "$src/Cargo.lock" "$evidence/Cargo.lock"
cp "$src/LICENSE" "$evidence/upstream-LICENSE"
cp "$here/solver.smoke.toml" "$evidence/solver.smoke.toml"
rustup toolchain install 1.99.1 --profile minimal
rustc +1.99.1 --version --verbose > "$evidence/rustc.txt"
cargo +1.99.1 --version > "$evidence/cargo.txt"
grep -q '^release: 1\.99\.1$' "$evidence/rustc.txt"
grep -q '^host: aarch64-unknown-linux-gnu$' "$evidence/rustc.txt"

# Download locked registry archives, then use offline Cargo for compilation.
(cd "$src" && cargo +1.99.1 fetch --locked)
(cd "$src" && cargo +1.99.1 metadata --locked --offline --format-version 1 \
  --filter-platform aarch64-unknown-linux-gnu) > "$work/metadata.json"
python3 "$here/verify_installation.py" inventory "$src/Cargo.lock" "$work/metadata.json" \
  > "$evidence/dependency-inventory.json"
(cd "$src" && cargo +1.99.1 tree --locked --offline -p minimal-shift-scheduling \
  --target aarch64-unknown-linux-gnu -e normal,build) > "$evidence/example-dependency-tree.txt"

# Real RustSec database, fetched fresh; audit the entire locked workspace
# before compiling any SolverForge source. Warnings require review.
audit_archive="$work/cargo-audit.tgz"
mkdir -p "$work/bin"
curl --fail --silent --show-error --location --retry 2 --max-time 180 \
  https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.23.0/cargo-audit-aarch64-unknown-linux-gnu-v0.23.0.tgz \
  -o "$audit_archive"
printf '%s  %s\n' 00eff3158429b9629abe8748e971f29f99ee53d4cff54a25072cbb15167bdda8 "$audit_archive" | sha256sum -c -
member=$(tar -tzf "$audit_archive" | grep -E '(^|/)cargo-audit$')
test "$(printf '%s\n' "$member" | wc -l)" = 1
tar -xOzf "$audit_archive" "$member" > "$work/bin/cargo-audit"
chmod 0755 "$work/bin/cargo-audit"
export PATH="$work/bin:$PATH"
cargo +1.99.1 audit --version > "$evidence/cargo-audit-version.txt"
git clone --depth=1 https://github.com/RustSec/advisory-db.git "$work/advisory-db"
git -C "$work/advisory-db" log -1 --format='%H%n%cI' > "$evidence/rustsec-database.txt"
# Run outside the upstream source directory; never allow the audit to
# generate or modify the dependency lock. No vulnerability ignore list.
(cd "$work" && cargo +1.99.1 audit --file "$src/Cargo.lock" --db "$work/advisory-db" \
  --no-fetch --deny warnings --json) > "$evidence/rustsec-report.json"
python3 "$here/verify_installation.py" rustsec "$src/Cargo.lock" "$evidence/rustsec-report.json" \
  "$evidence/rustsec-database.txt" > "$evidence/rustsec-summary.json"

# The upstream example owns its model and Cargo manifest. Override only the
# embedded solver.toml, preserving the published graph and all upstream tests.
cp "$here/solver.smoke.toml" "$src/examples/minimal-shift-scheduling/solver.toml"
(cd "$src" && cargo +1.99.1 test --locked --offline -p minimal-shift-scheduling -- --test-threads=1) \
  2>&1 | tee "$evidence/rust-tests.txt"
(cd "$src" && cargo +1.99.1 build --locked --offline --release -p minimal-shift-scheduling) \
  2>&1 | tee "$evidence/rust-build.txt"
test "$(git -C "$src" hash-object Cargo.lock)" = "$lock_blob"
test "$(git -C "$src" diff --name-only)" = examples/minimal-shift-scheduling/solver.toml

# Only the demo executable and public license enter the runtime build context.
mkdir "$work/image"
cp "$here/Dockerfile" "$work/image/Dockerfile"
install -m 0755 "$src/target/release/minimal-shift-scheduling" "$work/image/minimal-shift-scheduling"
cp "$src/LICENSE" "$work/image/LICENSE"
sha256sum "$work/image/minimal-shift-scheduling" | cut -d' ' -f1 > "$evidence/executable-sha256.txt"
docker build -q -t escalas-solverforge-smoke:ci "$work/image" > "$evidence/image-build.txt"
image=$(docker image inspect escalas-solverforge-smoke:ci --format '{{.Id}}')
test "$(docker image inspect "$image" --format '{{.Architecture}}')" = arm64
printf '%s\n' "$image" > "$evidence/image-id.txt"
# No real wire payload, credentials, database, volumes, or network.
timeout --signal=TERM --kill-after=1s 10s docker run --rm --pull=never --name "$container" \
  --network none --read-only --cgroupns=private --cap-drop ALL --security-opt no-new-privileges \
  --cpus 1 --memory 1536m --memory-swap 1536m --pids-limit 64 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=32m --user 1001:1001 \
  --env RAYON_NUM_THREADS=1 "$image" > "$work/demo-output.txt"
python3 "$here/verify_installation.py" demo "$work/demo-output.txt" | tee "$evidence/smoke-result.json"
test -z "$(docker ps -aq --filter "name=^/$container$")"
