import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkVersions } from "./check-toolchain.mjs";

test("accepts supported Node 24 and npm 11/12 only", () => {
  for (const [node, npm] of [["v24.19.0", "11.19.0"], ["v24.20.3", "12.0.1"], ["v24.30.0", "11.0.0"]]) {
    assert.equal(checkVersions(node, npm).ok, true, node + "/" + npm);
  }
});

test("rejects old, future, partial and malformed toolchains", () => {
  for (const [node, npm] of [["v24.18.9", "11.19.0"], ["v22.16.0", "11.19.0"], ["v25.0.0", "11.19.0"], ["v24.19.0", "10.9.0"], ["v24.19.0", "13.0.0"], ["24.19", "11.19.0"], ["unknown", "unknown"]]) {
    assert.equal(checkVersions(node, npm).ok, false, node + "/" + npm);
  }
});

test("the preflight never downloads or installs another Node version", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check-toolchain.mjs", import.meta.url))], {
    encoding: "utf8", env: { ...process.env, npm_config_user_agent: "npm/11.19.0 node/v22.16.0" }, timeout: 7000,
  });
  if (process.versions.node.startsWith("24.")) {
    assert.equal(result.status, 0, result.stderr);
  } else {
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Toolchain incompatível/);
    assert.match(result.stderr, /Não alteramos seu Node automaticamente/);
  }
});


test("Docker dependency stage copies the preflight script before npm ci", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
  const deps = dockerfile.split("FROM base AS deps")[1]?.split("FROM base AS migrator-deps")[0];
  assert.ok(deps, "Docker deps stage is missing");
  const copied = deps.indexOf("COPY scripts/check-toolchain.mjs ./scripts/check-toolchain.mjs");
  const installed = deps.indexOf("npm ci");
  assert.ok(copied >= 0 && installed > copied, "preinstall must be available when npm ci runs");
});
