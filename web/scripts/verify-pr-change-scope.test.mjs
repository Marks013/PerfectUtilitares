import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditPullRequest, checkCurrentPullRequest, declaredDeletions, isTestArtifact, parseNameStatusZ } from "./verify-pr-change-scope.mjs";

const change = (status, path, previousPath = null) => ({ status, path, previousPath });

test("parses NUL-delimited git changes including renamed paths", () => {
  assert.deepEqual(parseNameStatusZ("M\0web/src/lib/solver.ts\0R100\0docs/old.md\0docs/new.md\0"), [
    change("M", "web/src/lib/solver.ts"), change("R100", "docs/new.md", "docs/old.md"),
  ]);
  assert.deepEqual(parseNameStatusZ(""), []);
  assert.deepEqual(parseNameStatusZ("M\0web/src/app/api/escalas/[id]/route.ts\0"), [change("M", "web/src/app/api/escalas/[id]/route.ts")]);
  assert.throws(() => parseNameStatusZ("M\0oops"), /NUL-terminated/);
  assert.throws(() => parseNameStatusZ("X\0path\0"), /Unexpected git status/);
});

test("regression: test-only PR cannot erase previously approved runtime and documentation", () => {
  const changes = [change("A", "web/src/lib/escalas/publication-gates.test.tsx"),
    change("D", "docs/operations/M1-baseline-and-protection.md"),
    change("M", "web/src/lib/escalas/validation-time.ts")];
  const problems = auditPullRequest({ title: "test(M4): publication gates", body: "Only tests", changes });
  assert.equal(problems.length, 2);
  assert.match(problems.join(" "), /Undeclared file removal/);
  assert.match(problems.join(" "), /test: PR changes non-test files/);
});

test("explicitly documented, exact deletion is allowed outside test-only PRs", () => {
  const changes = [change("D", "docs/obsolete.md"), change("M", "README.md")];
  const body = "Removing obsolete docs.\n<!-- intentional-deletions:\ndocs/obsolete.md\n-->";
  assert.deepEqual(auditPullRequest({ title: "docs: prune obsolete docs", body, changes }), []);
  assert.deepEqual([...declaredDeletions(body)], ["docs/obsolete.md"]);
});

test("undeclared renames, stale declarations and wildcard authorization fail closed", () => {
  assert.match(auditPullRequest({ title: "refactor: move", changes: [change("R098", "docs/new.md", "docs/old.md")] }).join(" "), /docs\/old.md/);
  assert.match(auditPullRequest({ title: "docs: edit", body: "<!-- intentional-deletions:\nold.txt\n-->", changes: [change("M", "README.md")] }).join(" "), /do not match/);
  assert.throws(() => declaredDeletions("<!-- intentional-deletions:\nweb/**\n-->"), /literal/);
  assert.throws(() => declaredDeletions("<!-- intentional-deletions:\n../secrets\n-->"), /literal/);
  assert.throws(() => declaredDeletions("<!-- intentional-deletions:\na\na\n-->"), /distinct/);
});

test("test-only PRs may change tests, fixtures and e2e specs, but not runtime files", () => {
  const changes = [change("A", "web/src/foo.test.tsx"), change("M", "web/e2e/escala.spec.ts"),
    change("A", "web/ops/escalas/test_solver.py"), change("A", "web/test/fixtures/synthetic.json")];
  assert.deepEqual(auditPullRequest({ title: "test(escalas): add regression", changes }), []);
  assert.deepEqual(auditPullRequest({ title: "ci: update coverage", changes: [change("M", "web/src/runtime.ts")] }), []);
  assert.equal(isTestArtifact("web/src/lib/escalas/solver.py"), false);
  assert.equal(isTestArtifact("web/src/lib/escalas/publication-gates.test.tsx"), true);
});

test("checks the actual synthetic PR merge tree, not merely the proposed commit title", () => {
  const root = mkdtempSync(join(tmpdir(), "pu-guard-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: {
    ...process.env, GIT_AUTHOR_NAME: "CI", GIT_AUTHOR_EMAIL: "ci@example.test",
    GIT_COMMITTER_NAME: "CI", GIT_COMMITTER_EMAIL: "ci@example.test",
  } }).trim();
  try {
    git("init", "-b", "main");
    mkdirSync(join(root, "web/src/lib"), { recursive: true });
    writeFileSync(join(root, "web/src/lib/runtime.ts"), "export const active = true;\n");
    git("add", ".");
    git("commit", "-m", "baseline");
    const base = git("rev-parse", "HEAD");
    git("switch", "-c", "test-only-pr");
    unlinkSync(join(root, "web/src/lib/runtime.ts"));
    writeFileSync(join(root, "web/src/lib/publication.test.ts"), "// synthetic\n");
    git("add", "-A");
    git("commit", "-m", "test: publication");
    git("switch", "main");
    git("merge", "--no-ff", "test-only-pr", "-m", "synthetic PR merge");
    const eventPath = join(root, "event.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: base },
      title: "test(escalas): publication only", body: "Only a test file" } }));
    const result = checkCurrentPullRequest({ GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventPath }, root);
    assert.equal(result.changes, 2);
    assert.equal(result.problems.length, 2);
    assert.match(result.problems.join(" "), /runtime.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
