import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const container = process.env.ESCALAS_CI_POSTGRES_CONTAINER;
const runId = process.env.GITHUB_RUN_ID;
if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true"
  || !/^\d+$/.test(runId ?? "") || !/^[a-f0-9]{64}$/.test(container ?? "")) {
  throw new Error("This check requires the dedicated GitHub Actions PostgreSQL service.");
}
const [service] = JSON.parse(execFileSync("docker", ["inspect", container], { encoding: "utf8" }));
if (service.Id !== container || service.Config.Image !== "postgres:17"
  || !service.Config.Env.includes("POSTGRES_DB=perfectutilitares_ci")
  || !Object.keys(service.NetworkSettings.Networks).some(name => /^github_network_[a-f0-9]+$/.test(name))
  || service.State.Health?.Status !== "healthy") {
  throw new Error("Refusing to access a database outside the verified CI service.");
}

const migration = "20261114072100_escalas_scoped_access";
const migrations = new URL("../prisma/migrations/", import.meta.url);
const fixtures = new URL("../../docs/sql/", import.meta.url);
const read = (dir, path) => readFileSync(new URL(path, dir), "utf8");
const old = readdirSync(migrations, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^\d+_/.test(entry.name) && entry.name < migration)
  .map(entry => entry.name).sort();
const sql = read(migrations, migration + "/migration.sql");
const firstChange = sql.indexOf('ALTER TABLE "EscalaModuleSession"');
const injectAfter = sql.indexOf(";", firstChange) + 1;
if (!old.length || !/^\s*BEGIN;/m.test(sql) || firstChange < 0 || !injectAfter) {
  throw new Error("Unexpected legacy migration chain or missing transactional DDL.");
}

function pg(program, args, input) {
  return execFileSync("docker", ["exec", "-i", container, program, "-U", "postgres", ...args], {
    input, timeout: 90_000, maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
  });
}

const psql = (db, input) => pg("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", "-"], input).toString().trim();
const legacyDb = "escalas_access_test_" + runId + "_legacy";
const restoredDb = "escalas_access_test_" + runId + "_restored";
const legacyRows = String.raw`
INSERT INTO "User" ("id", "tenantId", "email", "name", "passwordHash", "role", "updatedAt")
VALUES ('upgrade-test-admin', 'escala-access-fixture-a', 'upgrade@example.invalid', 'Synthetic admin', 'TEST_ONLY_NON_LOGIN', 'ADMIN', CURRENT_TIMESTAMP);
INSERT INTO "EscalaWorkspace" ("id", "tenantId", "branchCode", "branchName", "startDate", "endDate", "revision", "status", "updatedAt")
VALUES ('upgrade-test-workspace', 'escala-access-fixture-a', '02', 'Synthetic branch', '2026-11-30', '2027-01-03', 1, 'PUBLISHED', CURRENT_TIMESTAMP);
INSERT INTO "EscalaRevision" ("id", "tenantId", "workspaceId", "revision", "status", "input", "createdById")
VALUES ('upgrade-test-revision', 'escala-access-fixture-a', 'upgrade-test-workspace', 1, 'PUBLISHED', '{"synthetic":true}', 'upgrade-test-admin');
`;
const fingerprint = db => {
  const result = psql(db, String.raw`
SELECT jsonb_build_array(
  to_jsonb(s) - ARRAY['operatorId', 'accessPolicyVersion', 'permissionVersion'],
  to_jsonb(w), to_jsonb(r) - 'approvedPolicyVersionId')
FROM "EscalaModuleSession" s, "EscalaWorkspace" w, "EscalaRevision" r
WHERE s.id='escala-access-fixture-legacy' AND w.id='upgrade-test-workspace' AND r.id='upgrade-test-revision';
`);
  if (!result) throw new Error("A legacy session, workspace or revision was lost.");
  return createHash("sha256").update(result).digest("hex");
};

const created = [];
try {
  pg("createdb", [legacyDb]); created.push(legacyDb);
  for (const path of old) psql(legacyDb, read(migrations, path + "/migration.sql"));
  psql(legacyDb, read(fixtures, "escalas-access-foundation.fixture-before.sql"));
  psql(legacyDb, legacyRows);
  const before = fingerprint(legacyDb);
  const snapshot = pg("pg_dump", ["--format=custom", "--no-owner", "--no-acl", legacyDb]);
  let rollbackObserved = false;
  try {
    psql(legacyDb, sql.slice(0, injectAfter) + "\nSELECT 1 / 0;\n" + sql.slice(injectAfter));
  } catch (error) {
    if (error.status !== 3 || !/division by zero/.test(error.stderr?.toString() ?? "")) throw error;
    rollbackObserved = true;
  }
  if (!rollbackObserved || fingerprint(legacyDb) !== before || psql(legacyDb, String.raw`
SELECT NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name='EscalaModuleSession' AND column_name='operatorId')
  AND to_regclass('"EscalaOperator"') IS NULL;`) !== "t") {
    throw new Error("The controlled failure left a partial change.");
  }

  pg("createdb", [restoredDb]); created.push(restoredDb);
  pg("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname=" + restoredDb], snapshot);
  if (fingerprint(restoredDb) !== before) throw new Error("The restored legacy rows differ.");
  for (const db of [legacyDb, restoredDb]) {
    psql(db, sql);
    if (fingerprint(db) !== before || psql(db, 'SELECT "approvedPolicyVersionId" IS NULL FROM "EscalaRevision" WHERE id = \'upgrade-test-revision\';') !== "t") {
      throw new Error("The upgrade changed protected legacy data.");
    }
    for (const check of ["escalas-access-foundation.verify.sql", "escalas-approved-policy.verify.sql"]) {
      psql(db, read(fixtures, check));
    }
  }
  console.log("Synthetic Escalas legacy upgrade, rollback, restore and constraint checks passed.");
} finally {
  for (const db of created.reverse()) pg("dropdb", ["--if-exists", db]);
}
