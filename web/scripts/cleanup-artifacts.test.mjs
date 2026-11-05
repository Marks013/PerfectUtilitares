import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

function fixture(t) {
  const base = fs.mkdtempSync(path.join(tmpdir(), "perfectutilitares-cleanup-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  const outside = path.join(base, "outside");
  const script = path.join(root, "scripts", "cleanup-artifacts.mjs");
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.mkdirSync(outside);
  fs.copyFileSync(new URL("./cleanup-artifacts.mjs", import.meta.url), script);
  return {
    root,
    outside,
    run(keep) {
      return spawnSync(process.execPath, [script], {
        cwd: root,
        env: { ...process.env, ARTIFACT_KEEP_LIMIT: keep },
        encoding: "utf8",
      });
    },
  };
}

test("cleanup does not traverse rotated directories or temporary folders linked elsewhere", (t) => {
  const { root, outside, run } = fixture(t);
  const protectedFile = path.join(outside, "keep");
  fs.writeFileSync(protectedFile, "outside");
  for (const name of ["artifacts", "tmp"]) {
    fs.symlinkSync(outside, path.join(root, name), "junction");
  }

  const result = run("0");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(protectedFile, "utf8"), "outside");
  for (const name of ["artifacts", "tmp"]) {
    assert.equal(fs.lstatSync(path.join(root, name)).isSymbolicLink(), true);
  }
});

test("cleanup retains the latest regular artifact and ignores linked entries", (t) => {
  const { root, outside, run } = fixture(t);
  const artifacts = path.join(root, "artifacts");
  fs.mkdirSync(artifacts);
  fs.mkdirSync(path.join(root, "tmp"));
  const old = path.join(artifacts, "old");
  const latest = path.join(artifacts, "latest");
  const linked = path.join(artifacts, "linked");
  fs.writeFileSync(old, "old");
  fs.writeFileSync(latest, "latest");
  fs.utimesSync(old, 1, 1);
  fs.utimesSync(latest, 2, 2);
  fs.symlinkSync(outside, linked, "junction");

  const result = run("1");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(latest), true);
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(root, "tmp")), false);
});

test("cleanup refuses invalid retention limits before removing anything", (t) => {
  const { root, run } = fixture(t);
  const temporary = path.join(root, "tmp");
  fs.mkdirSync(temporary);

  for (const keep of ["", "-1", "NaN", "1.5", "9007199254740992"]) {
    const result = run(keep);
    assert.notEqual(result.status, 0, `accepted ${JSON.stringify(keep)}`);
    assert.match(result.stderr, /ARTIFACT_KEEP_LIMIT/);
    assert.equal(fs.existsSync(temporary), true);
  }
});
