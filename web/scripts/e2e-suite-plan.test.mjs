import assert from "node:assert/strict";
import test from "node:test";
import { cleanupPhase, listedCases, nominalSpecs, parseSuiteArguments, phaseEnvironment, phaseSelection, selectedPhases, suitePhases } from "./e2e-suite-plan.mjs";

test("every spec belongs to exactly one phase, with one explicit nominal list", () => {
  assert.deepEqual(suitePhases, ["general", "nominal"]);
  assert.deepEqual(nominalSpecs, ["escalas-scoped-access.spec.ts"]);
  const general = phaseSelection("general").testIgnore;
  const nominal = phaseSelection("nominal").testMatch;
  assert.deepEqual(general, nominal);
  for (const file of [...nominalSpecs, "escalas-import-replacement.spec.ts", "auth.spec.ts"]) {
    const nominalMember = nominal.includes(`**/${file}`);
    const generalMember = !general.includes(`**/${file}`);
    assert.equal(Number(nominalMember) + Number(generalMember), 1);
  }
  assert.throws(() => phaseSelection("invalid"));
});

test("seed stays principal; only nominal app/test receives the new, unseeded tenant", () => {
  const inherited = Object.freeze({ ADMIN_EMAIL: "foreign", ADMIN_PASSWORD: "foreign", SEED_ADMIN_EMAIL: "foreign", SEED_ADMIN_PASSWORD: "foreign", DEFAULT_TENANT_SLUG: "foreign", E2E_EXCLUSIVE_SCOPED_TENANT_SLUG: "foreign", E2E_ARTIFACT_DIR: "foreign", CI: "true" });
  const general = phaseEnvironment(inherited, "general", { runId: "run-1", adminPassword: "general-secret" });
  const nominal = phaseEnvironment(inherited, "nominal", { runId: "run-1", adminPassword: "nominal-secret" });
  for (const phase of [general, nominal]) {
    assert.equal(phase.seed.DEFAULT_TENANT_SLUG, "principal");
    assert.equal(phase.seed.E2E_EXCLUSIVE_SCOPED_TENANT_SLUG, undefined);
    for (const env of [phase.seed, phase.runtime]) {
      assert.equal(env.SEED_ADMIN_EMAIL, undefined);
      assert.equal(env.SEED_ADMIN_PASSWORD, undefined);
      assert.equal(env.E2E_ARTIFACT_DIR, undefined);
      assert.equal(env.E2E_OWNED_ACCOUNT_PROVISIONING, "1");
      assert.equal(env.CI, "true");
    }
    assert.equal(phase.seed.ADMIN_EMAIL, phase.runtime.ADMIN_EMAIL);
    assert.equal(phase.seed.ADMIN_PASSWORD, phase.runtime.ADMIN_PASSWORD);
  }
  assert.equal(general.runtime.DEFAULT_TENANT_SLUG, "principal");
  assert.equal(general.runtime.E2E_EXCLUSIVE_SCOPED_TENANT_SLUG, undefined);
  assert.equal(nominal.runtime.DEFAULT_TENANT_SLUG, "e2e-run-1");
  assert.equal(nominal.runtime.E2E_EXCLUSIVE_SCOPED_TENANT_SLUG, "e2e-run-1");
  assert.notEqual(general.seed.ADMIN_EMAIL, nominal.seed.ADMIN_EMAIL);
  assert.notEqual(general.seed.ADMIN_PASSWORD, nominal.seed.ADMIN_PASSWORD);
  assert.equal(inherited.ADMIN_EMAIL, "foreign");
  assert.throws(() => phaseEnvironment({}, "nominal", { runId: "../escape", adminPassword: "x" }));
});

test("focused positional, line, grep and project selectors are preserved", () => {
  const args = ["e2e/escalas-scoped-access.spec.ts:42", "--grep=scope", "--grep-invert", "slow", "--project", "chromium", "--headed", "--workers=1", "--retries", "0"];
  assert.deepEqual(parseSuiteArguments([...args, "--list"]), { args: [args[0], "--grep", "scope", "--grep-invert", "slow", "--project", "chromium", "--headed", "--workers", "1", "--retries", "0"], list: true });
});

test("conflicting parallelism and selection/config/report bypasses are rejected", () => {
  for (const args of [["--workers=2"], ["-j", "50%"], ["-j2"], ["--fully-parallel"], ["--repeat-each=2"], ["--retries=1"], ["--config=other.ts"], ["-c", "other.ts"], ["--pass-with-no-tests"], ["--shard=1/2"], ["--test-list=other"], ["--last-failed"], ["--output=other"], ["--reporter=html"], ["--grep"]]) assert.throws(() => parseSuiteArguments(args), args.join(" "));
});

test("collection errors fail; filtered phases skip without accepting an empty suite", () => {
  const report = { suites: [{ suites: [{ specs: [{ file: "a.spec.ts", line: 4, column: 1, title: "real case", tests: [{ projectName: "chromium" }] }] }] }] };
  const cases = listedCases(report);
  assert.deepEqual(cases, ["a.spec.ts:4:1:real case:chromium"]);
  assert.throws(() => listedCases({ errors: [{ message: "collection error" }] }));
  assert.deepEqual(selectedPhases({ general: cases, nominal: [] }), ["general"]);
  assert.deepEqual(selectedPhases({ general: [], nominal: cases }), ["nominal"]);
  assert.deepEqual(selectedPhases({ general: ["a"], nominal: ["b"] }), suitePhases);
  assert.throws(() => selectedPhases({ general: [], nominal: [] }), /No tests/);
  assert.throws(() => selectedPhases({ general: cases, nominal: cases }), /Duplicate/);
  assert.throws(() => selectedPhases({ general: cases }), /Missing collection/);
});

test("cleanup attempts all exact resources after partial failure and reports failures", async () => {
  const calls = [];
  await assert.rejects(cleanupPhase([
    ["solver-id", async () => { calls.push("solver-id"); throw new Error("failed"); }],
    ["owned-database", async () => { calls.push("owned-database"); throw new Error("failed"); }],
    ["mail-server", async () => { calls.push("mail-server"); }],
  ]), /solver-id, owned-database/);
  assert.deepEqual(calls, ["solver-id", "owned-database", "mail-server"]);
  await cleanupPhase([]);
});
