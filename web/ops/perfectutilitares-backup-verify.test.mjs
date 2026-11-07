import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./perfectutilitares-backup-verify", import.meta.url), "utf8");
const shellAvailable = existsSync("/bin/sh");

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing script section ${start}`);
  return source.slice(from, to);
}

function runShell(script) {
  return spawnSync("/bin/sh", ["-s"], {
    input: `set -eu\nexec 3>&1\n${script}\n`,
    encoding: "utf8",
    timeout: 5000,
  });
}

const cleanup = section("cleanup_database() {", "\ndocker compose exec -T -e VERIFY_DATABASE=");
const archive = section('  archive_paths=$(tar -tzf "$backup/host-files.tar.gz")', "\nfi\n");
const lockConfig = section("GUARD_LOCK_FILE=", '\nexec 8>>"$GUARD_LOCK_FILE"');
const lockAdmission = section('flock --wait "$LOCK_WAIT_SECONDS" 8', "\nrequested=");
const snapshotSelection = section('if [ "$requested" = latest ]; then', '\n[ -n "$backup" ]');

test("the operations lock is acquired before selecting or reading a snapshot", () => {
  const lock = source.indexOf('flock --wait "$LOCK_WAIT_SECONDS" 8');
  for (const read of ['backup=$(find ', 'backup=$(realpath ', "sha256sum --check", "pg_restore --list"]) {
    assert.ok(lock >= 0 && lock < source.indexOf(read), `${read} must follow the lock`);
  }
});

test("the verifier remains valid POSIX shell", { skip: !shellAvailable }, () => {
  const result = spawnSync("/bin/sh", ["-n"], { input: source, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("lock timeout and unsafe lock paths are rejected before opening a lock", { skip: !shellAvailable }, () => {
  for (const config of [
    "BACKUP_LOCK_WAIT_SECONDS=invalid",
    "BACKUP_LOCK_WAIT_SECONDS=3601",
    "SERVER_OPERATIONS_LOCK_FILE=/tmp/unrelated.lock",
    "SERVER_OPERATIONS_LOCK_FILE=/run/lock/../../unrelated.lock",
  ]) {
    const result = runShell(`${config}\n${lockConfig}\necho accepted`);
    assert.equal(result.status, 2, result.stderr);
    assert.doesNotMatch(result.stdout, /accepted/);
  }
});

test("lock admission uses the bounded wait and precedes snapshot selection", { skip: !shellAvailable }, () => {
  const result = runShell(`
LOCK_WAIT_SECONDS=12
BACKUP_ROOT=/unused
requested=latest
flock() { printf 'lock %s\\n' "$*" >&3; }
find() { echo selected >&3; printf '1 /unused/snapshot\\n'; }
${lockAdmission}
${snapshotSelection}
printf 'snapshot=%s\\n' "$backup"
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lock --wait 12 8\nselected\nsnapshot=\/unused\/snapshot/);
});

test("lock contention stops before reading a snapshot", { skip: !shellAvailable }, () => {
  const result = runShell(`
LOCK_WAIT_SECONDS=0
flock() { return 1; }
${lockAdmission}
echo selected
`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Timeout aguardando/);
  assert.doesNotMatch(result.stdout, /selected/);
});

test("archive read failure fails verification", { skip: !shellAvailable }, () => {
  const result = runShell(`backup=/unused\ntar() { return 2; }\n${archive}\necho accepted`);
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout, /accepted/);
});

test("unsafe archive paths fail verification", { skip: !shellAvailable }, () => {
  for (const path of ["/absolute/file", "../outside", "directory/../outside"]) {
    const result = runShell(`backup=/unused\ntar() { printf '%s\\n' '${path}'; }\n${archive}\necho accepted`);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /caminho inseguro/);
    assert.doesNotMatch(result.stdout, /accepted/);
  }
});

test("safe readable archive paths pass verification", { skip: !shellAvailable }, () => {
  const result = runShell(`backup=/unused\ntar() { printf 'directory/file\\n'; }\n${archive}\necho accepted`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /accepted/);
});

test("successful database cleanup runs once and preserves success", { skip: !shellAvailable }, () => {
  const result = runShell(`
verify_database=simulation
docker() { echo cleanup >&3; }
${cleanup}
cleanup_database
trap - EXIT HUP INT TERM
echo accepted
`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "cleanup\naccepted\n");
});

test("failed database cleanup cannot announce success", { skip: !shellAvailable }, () => {
  const result = runShell(`
verify_database=simulation
docker() { return 2; }
${cleanup}
cleanup_database
trap - EXIT HUP INT TERM
echo accepted
`);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Falha ao remover o banco temporario/);
  assert.doesNotMatch(result.stdout, /accepted/);
});

test("cleanup failure preserves an earlier verification error", { skip: !shellAvailable }, () => {
  const result = runShell(`verify_database=simulation\ndocker() { return 2; }\n${cleanup}\nexit 7`);
  assert.equal(result.status, 7);
  assert.match(result.stderr, /Falha ao remover o banco temporario/);
});

test("cleanup failure turns a successful exit into a failure", { skip: !shellAvailable }, () => {
  const result = runShell(`verify_database=simulation\ndocker() { return 2; }\n${cleanup}\nexit 0`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Falha ao remover o banco temporario/);
});

test("signals stop verification and clean up exactly once", { skip: !shellAvailable }, () => {
  for (const [signal, status] of [["HUP", 129], ["INT", 130], ["TERM", 143]]) {
    const result = runShell(`
verify_database=simulation
docker() { echo cleanup >&3; }
${cleanup}
kill -${signal} $$
echo continued
`);
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, "cleanup\n");
  }
});
