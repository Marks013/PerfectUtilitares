import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { frozenBenchmarkSource, prepareEvaluator } from "./solverforge-source.ts";

const comparator = "web/scripts/escalas/cross-engine";
const evaluatorPath = "web/src/lib/escalas/probe.ts";

function fixture(t: TestContext) {
  const scratch = mkdtempSync(join(process.env.ESCALAS_FORGE_TEST_TEMP ?? tmpdir(), "sf-source-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const candidateRoot = join(scratch, "candidate");
  const evaluatorRoot = join(scratch, "evaluator");
  mkdirSync(candidateRoot);
  function git(root: string, ...args: string[]) {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  function commit(message: string) {
    git(candidateRoot, "add", ".");
    git(candidateRoot, "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.invalid", "commit", "-qm", message);
    return git(candidateRoot, "rev-parse", "HEAD");
  }
  function candidateFile(path: string, content: string) {
    const absolute = join(candidateRoot, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  git(candidateRoot, "init", "-q");
  candidateFile(evaluatorPath, "export const value = 'original evaluator';\n");
  const evaluatorRevision = commit("frozen evaluator");
  git(candidateRoot, "clone", "-q", "--no-checkout", candidateRoot, evaluatorRoot);
  git(evaluatorRoot, "checkout", "-q", "--detach", evaluatorRevision);
  candidateFile(`${comparator}/core.ts`, "export const core = 'common';\n");
  candidateFile(`${comparator}/fixtures.ts`, "export const fixture = 'common';\n");
  const controlRevision = commit("frozen control");
  candidateFile(evaluatorPath, "export const value = 'different candidate';\n");
  candidateFile(`${comparator}/docker.ts`, "export const adapter = 'synthetic';\n");
  candidateFile(`${comparator}/cli.ts`, "export const smoke = 'synthetic';\n");
  candidateFile(`${comparator}/solverforge-source.ts`, "export const source = 'synthetic';\n");
  candidateFile(`${comparator}/solverforge-compare.ts`, "export const compare = 'committed';\n");
  candidateFile("web/experiments/escalas-solverforge/src/e3a-fixed-clock-contract.json", "{}\n");
  const candidateRevision = commit("candidate with incompatible evaluator tree");
  return { evaluatorRoot, evaluatorRevision, candidateRoot, candidateRevision, controlRevision, candidateFile, commit };
}

test("freezes original evaluator despite a different candidate tree and binds only committed harness bytes", t => {
  const checkout = fixture(t);
  checkout.candidateFile(`${comparator}/solverforge-compare.ts`, "export const compare = 'dirty';\n");
  const identity = prepareEvaluator(checkout);
  assert.equal(identity.revision, checkout.candidateRevision);
  assert.equal(identity.evaluatorRevision, checkout.evaluatorRevision);
  assert.match(identity.harnessSha256, /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(join(checkout.evaluatorRoot, evaluatorPath), "utf8").trim(), "export const value = 'original evaluator';");
  assert.equal(readFileSync(join(checkout.evaluatorRoot, comparator, "solverforge-compare.ts"), "utf8").trim(), "export const compare = 'committed';");
  assert.deepEqual(frozenBenchmarkSource(checkout), identity);
});

test("rejects changes to the original evaluator, an extra source, and a modified harness", t => {
  const checkout = fixture(t);
  const evaluator = join(checkout.evaluatorRoot, evaluatorPath);
  const original = readFileSync(evaluator);
  writeFileSync(evaluator, "changed evaluator\n");
  assert.throws(() => prepareEvaluator(checkout), /FORGE_DIRTY_EVALUATOR/);
  writeFileSync(evaluator, original);
  prepareEvaluator(checkout);
  const extra = join(checkout.evaluatorRoot, comparator, "unreviewed.ts");
  writeFileSync(extra, "unreviewed\n");
  assert.throws(() => frozenBenchmarkSource(checkout), /FORGE_DIRTY_EVALUATOR/);
  rmSync(extra);
  writeFileSync(join(checkout.evaluatorRoot, comparator, "core.ts"), "changed staged harness\n");
  assert.throws(() => frozenBenchmarkSource(checkout), /FORGE_HARNESS_MISMATCH/);
});

test("rejects reused checkouts, candidate revision drift and divergence from historical comparator", t => {
  const checkout = fixture(t);
  assert.throws(() => prepareEvaluator({ ...checkout, evaluatorRoot: checkout.candidateRoot }), /FORGE_CHECKOUTS_NOT_SEPARATE/);
  assert.throws(() => prepareEvaluator({ ...checkout, candidateRevision: checkout.controlRevision }), /FORGE_GIT_IDENTITY/);
  checkout.candidateFile(`${comparator}/core.ts`, "export const core = 'different';\n");
  const candidateRevision = checkout.commit("unreviewed comparator");
  assert.throws(() => prepareEvaluator({ ...checkout, candidateRevision }), /FORGE_FROZEN_COMPARATOR_MISMATCH/);
});
