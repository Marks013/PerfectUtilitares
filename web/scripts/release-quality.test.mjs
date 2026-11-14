import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertReleaseQuality, qualityProfile, runReleaseQuality, sourceSnapshot } from "./release-quality.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "release-quality-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "web");
  mkdirSync(cwd); mkdirSync(path.join(root, ".git"));
  const scripts = { quality: "node scripts/release-quality.mjs",
    "quality:code": "npm run prisma:validate && npm run typecheck && npm run lint && npm run test:ops && npm run test:coverage && npm run quality:dead-code && npm run quality:module-size && npm run quality:route-tests",
    "test:e2e:isolated": "node scripts/run-isolated-e2e.mjs", "test:coverage": "vitest run --coverage" };
  const packageFile = path.join(cwd, "package.json");
  writeFileSync(packageFile, JSON.stringify({ scripts }));
  const source = path.join(cwd, "source.ts"); writeFileSync(source, "export const value = 1;\n");
  const lock = path.join(cwd, "package-lock.json"); writeFileSync(lock, "{}\n");
  const file = path.join(root, ".git", "release-quality.json");
  const calls = [];
  const tracked = new Set(["web/package.json", "web/package-lock.json", "web/source.ts"]);
  let npm = "11.19.0", clock = 100000, onStep = () => {};
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === "git") {
      if (args.includes("--absolute-git-dir")) return path.join(root, ".git");
      if (args.includes("--show-toplevel")) return root;
      if (args[0] === "ls-files") return (args.includes("--others")
        ? [...readdirSync(cwd).map(file => `web/${file}`), ...[...tracked].filter(file => !file.startsWith("web/"))]
        : [...tracked]).join("\0") + "\0";
    }
    if (command === "npm" && args[0] === "--version") return npm;
    if (command === "npm" && args[0] === "run") { onStep(args[1]); return ""; }
    throw new Error("Unexpected command");
  };
  const options = { cwd, env: {}, run, now: () => clock };
  return { ...options, options, root, calls, file, source, lock, packageFile, scripts,
    track: (...files) => files.forEach(file => tracked.add(file)),
    setStep: value => { onStep = value; }, setClock: value => { clock = value; }, setNpm: value => { npm = value; } };
}

test("proof requires both complete canonical stages, runs once, and survives a content-identical commit", t => {
  const f = fixture(t);
  runReleaseQuality(f.options);
  const beforeCommit = assertReleaseQuality(f.options);
  // HEAD/index metadata is deliberately absent from content identity.
  writeFileSync(path.join(path.dirname(f.file), "HEAD"), "ref: refs/heads/committed-after-quality\n");
  assert.deepEqual(assertReleaseQuality(f.options), beforeCommit);
  assert.equal(f.calls.some(call => call[0] === "git" && call.includes("HEAD")), false);
  assert.deepEqual(f.calls.filter(call => call[1] === "run"), [["npm", "run", "quality:code"], ["npm", "run", "test:e2e:isolated"]]);
  assert.equal(JSON.parse(readFileSync(f.file)).snapshot.profile.mode, "complete-isolated-development-v1");
  assert.equal(readFileSync(f.file, "utf8").includes(f.cwd), false);
});

test("absent, failed, partial, malformed and old proof never authorizes release", t => {
  const f = fixture(t);
  assert.throws(() => assertReleaseQuality(f.options));
  runReleaseQuality(f.options);
  const valid = JSON.parse(readFileSync(f.file));
  for (const changes of [{ status: "FAILED" }, { steps: valid.steps.slice(0, 1) }, { version: 0 },
    { completedAt: -86400001 }, { completedAt: 100001 }]) {
    writeFileSync(f.file, JSON.stringify({ ...valid, ...changes }));
    assert.throws(() => assertReleaseQuality(f.options));
  }
  writeFileSync(f.file, "not json"); assert.throws(() => assertReleaseQuality(f.options));
  writeFileSync(f.file, JSON.stringify(valid)); f.setClock(100000 + 86400001);
  assert.throws(() => assertReleaseQuality(f.options));
});

for (const failed of ["quality:code", "test:e2e:isolated"]) {
  test(`failure of ${failed} removes prior proof and cannot produce partial approval`, t => {
    const f = fixture(t); runReleaseQuality(f.options);
    f.setStep(name => { if (name === failed) throw new Error("simulated failure"); });
    assert.throws(() => runReleaseQuality(f.options), /simulated failure/);
    assert.equal(existsSync(f.file), false);
  });
}

test("changed source, lockfile and runtime invalidate proof, including edits during quality", t => {
  const f = fixture(t); runReleaseQuality(f.options);
  writeFileSync(f.source, "export const value = 2;\n");
  assert.throws(() => assertReleaseQuality(f.options));
  runReleaseQuality(f.options); writeFileSync(f.lock, '{"lockfileVersion":3}\n');
  assert.throws(() => assertReleaseQuality(f.options));
  runReleaseQuality(f.options); f.setNpm("11.20.0");
  assert.throws(() => assertReleaseQuality(f.options));
  f.setStep(name => { if (name === "test:e2e:isolated") writeFileSync(f.source, "changed during E2E"); });
  assert.throws(() => runReleaseQuality(f.options), /mudou/);
  assert.equal(existsSync(f.file), false);
});

test("new uncommitted source is part of proof while environment payloads are never fingerprinted", t => {
  const f = fixture(t); runReleaseQuality(f.options);
  writeFileSync(path.join(f.cwd, "new-source.ts"), "new source");
  assert.throws(() => assertReleaseQuality(f.options));
  runReleaseQuality(f.options);
  writeFileSync(path.join(f.cwd, ".env"), "SYNTHETIC_TEST_VALUE=one");
  const before = assertReleaseQuality(f.options);
  writeFileSync(path.join(f.cwd, ".env"), "SYNTHETIC_TEST_VALUE=two");
  assert.deepEqual(assertReleaseQuality(f.options), before);
});

test("extra arguments and scope-reducing environment reject and invalidate old proof", t => {
  const f = fixture(t);
  for (const env of [{ VITEST_GREP: "one" }, { PW_TEST_GREP: "one" }, { PLAYWRIGHT_TEST_LIST: "one" },
    { npm_config_ignore_scripts: "true" }, { npm_config_dry_run: "true" }, { npm_config_workspace: "one" },
    { E2E_PRODUCTION: "1" }, { E2E_EXTERNAL_URL: "https://example.test" }, { NODE_OPTIONS: "--import=other" }]) {
    runReleaseQuality(f.options);
    assert.throws(() => runReleaseQuality({ ...f.options, env }));
    assert.equal(existsSync(f.file), false);
  }
  runReleaseQuality(f.options);
  assert.throws(() => runReleaseQuality({ ...f.options, args: ["--grep", "one"] }));
  assert.equal(existsSync(f.file), false);
});

test("filtered or reduced package scripts cannot issue canonical proof", t => {
  const f = fixture(t);
  for (const [name, value] of [["quality:code", "npm run typecheck"], ["test:e2e:isolated", "node scripts/run-isolated-e2e.mjs --grep one"],
    ["test:coverage", "vitest run --coverage one.test.ts"], ["quality", "echo skipped"]]) {
    writeFileSync(f.packageFile, JSON.stringify({ scripts: { ...f.scripts, [name]: value } }));
    assert.throws(() => runReleaseQuality(f.options), /canônica/);
    assert.equal(existsSync(f.file), false);
  }
});

test("native conditional fixtures are recorded as presence only, never as private values", () => {
  const profile = qualityProfile({ E2E_REAL_CSV_PATH: "/private/team.csv", E2E_REAL_ABSENCES_PATH: "/private/absence.csv", E2E_EMPTY_TURNO_CATALOG: "1" });
  assert.equal(profile.privateCsv, true); assert.equal(profile.privateAbsences, true); assert.equal(profile.emptyCatalog, true);
  assert.equal(JSON.stringify(profile).includes("/private"), false);
});

test("tracked symlink to an internal tracked file is admissible and target edits invalidate proof", t => {
  const f = fixture(t);
  symlinkSync("web/source.ts", path.join(f.root, "CLAUDE.md"));
  f.track("CLAUDE.md");
  runReleaseQuality(f.options);
  assertReleaseQuality(f.options);
  writeFileSync(f.source, "target changed");
  assert.throws(() => assertReleaseQuality(f.options));
});

test("tracked symlink identity changes even when the new internal target has identical bytes", t => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, "same.ts"), readFileSync(f.source));
  f.track("web/link.md", "web/same.ts");
  const link = path.join(f.cwd, "link.md");
  symlinkSync("source.ts", link);
  runReleaseQuality(f.options);
  unlinkSync(link); symlinkSync("same.ts", link);
  assert.throws(() => assertReleaseQuality(f.options));
});

test("tracked symlink chains remain bound to each internal tracked link and final content", t => {
  const f = fixture(t);
  symlinkSync("second.md", path.join(f.cwd, "first.md"));
  symlinkSync("source.ts", path.join(f.cwd, "second.md"));
  f.track("web/first.md", "web/second.md");
  assert.ok(sourceSnapshot(f.cwd, f.env, f.run).contentHash);
});

for (const kind of ["external", "broken", "cycle", "protected", "untracked-target", "untracked-link", "parent-symlink"]) {
  test(`tracked symlink rejects ${kind} without reading an unsafe target`, t => {
    const f = fixture(t);
    const link = path.join(f.cwd, "link.md");
    if (kind !== "untracked-link") f.track("web/link.md");
    let target = "source.ts";
    if (kind === "external") target = "/etc/hosts";
    if (kind === "broken") { target = "missing.ts"; f.track("web/missing.ts"); }
    if (kind === "cycle") {
      target = "second.md"; symlinkSync("link.md", path.join(f.cwd, "second.md")); f.track("web/second.md");
    }
    if (kind === "protected") {
      target = ".env"; writeFileSync(path.join(f.cwd, ".env"), "SYNTHETIC_TEST_ONLY=unused"); f.track("web/.env");
    }
    if (kind === "untracked-target") { target = "new.ts"; writeFileSync(path.join(f.cwd, target), "not tracked"); }
    if (kind === "parent-symlink") {
      symlinkSync("/tmp", path.join(f.cwd, "intermediate"));
      target = "intermediate/not-read.ts"; f.track("web/intermediate/not-read.ts");
    }
    symlinkSync(target, link);
    assert.throws(() => sourceSnapshot(f.cwd, f.env, f.run));
  });
}
