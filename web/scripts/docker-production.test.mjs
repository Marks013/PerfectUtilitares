import assert from "node:assert/strict";
import test from "node:test";
import { assertRunningRevision, productionServices, releaseProduction } from "./docker-production.mjs";

const revision = "a".repeat(40);
const env = { SOURCE_REVISION: revision };
function executor(ids, states, calls = []) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return args[0] === "compose" ? ids : states;
  };
}

test("every built and deployed service, including Solver, must match its revision", () => {
  assert.deepEqual(productionServices, ["app", "pdf-worker", "escalas-solver"]);
  for (const service of productionServices) {
    const calls = [];
    assertRunningRevision(service, revision, env, executor("one\ntwo", `true ${revision}\ntrue ${revision}`, calls));
    assert.equal(calls[0].args.at(-1), service);
    assert.deepEqual(calls[1].args.slice(-2), ["one", "two"]);
    assert.equal(calls[0].options.env, env);
    assert.equal(calls[1].options.capture, true);
  }
});

test("rejects missing, stopped, mismatched and partially updated replicas", () => {
  for (const [ids, states] of [
    ["", ""],
    ["one", `false ${revision}`],
    ["one", "true " + "b".repeat(40)],
    ["one\ntwo", `true ${revision}`],
    ["one\ntwo", `true ${revision}\ntrue ${"b".repeat(40)}`],
  ]) {
    assert.throws(() => assertRunningRevision("escalas-solver", revision, env, executor(ids, states)));
  }
});

test("propagates Docker inspection failure instead of reporting success", () => {
  assert.throws(() => assertRunningRevision("app", revision, env, () => {
    throw new Error("Docker unavailable");
  }), /Docker unavailable/);
});

function releaseFixture() {
  const events = [];
  let dirty = "", current = revision, onDocker = () => {};
  const execute = (command, args) => {
    events.push([command, ...args]);
    if (command === "git") return args[0] === "status" ? dirty : current;
    onDocker(args);
    if (args[0] === "inspect") return `true ${revision}`;
    if (args[0] === "compose" && args[1] === "ps" && args.includes("--quiet")) return "container";
    return "";
  };
  return { events, execute, environment: {}, quality: () => events.push(["quality-proof"]),
    setDirty: value => { dirty = value; }, setRevision: value => { current = value; },
    setDocker: value => { onDocker = value; } };
}

test("absent, failed, partial, stale and changed proof denies before ANY Docker command", () => {
  for (const reason of ["absent", "failed", "partial", "stale", "content-change"]) {
    const f = releaseFixture();
    assert.throws(() => releaseProduction("deploy", { ...f, quality: () => { throw new Error(reason); } }), new RegExp(reason));
    assert.equal(f.events.some(event => event[0] === "docker"), false);
  }
});

test("one deploy consumes proof before config/build/up and preserves service revision checks", () => {
  const f = releaseFixture(); releaseProduction("deploy", f);
  const operations = f.events.filter(event => event[0] !== "git");
  assert.deepEqual(operations.slice(0, 6).map(event => event.slice(0, 3)), [
    ["quality-proof"], ["docker", "compose", "config"], ["quality-proof"],
    ["docker", "compose", "build"], ["quality-proof"], ["docker", "compose", "up"],
  ]);
  assert.equal(f.events.filter(event => event[0] === "docker" && event[2] === "build").length, 1);
  assert.equal(f.events.filter(event => event[0] === "docker" && event[1] === "inspect").length, productionServices.length);
  assert.equal(f.events.some(event => event[0] === "npm"), false);
});

test("dirty or changed checkout is refused initially and after Compose validation", () => {
  const dirty = releaseFixture(); dirty.setDirty(" M web/source.ts");
  assert.throws(() => releaseProduction("build", dirty), /limpo/);
  assert.equal(dirty.events.some(event => event[0] === "docker"), false);
  for (const change of ["dirty", "revision"]) {
    const f = releaseFixture();
    f.setDocker(args => { if (args[1] === "config") change === "dirty" ? f.setDirty(" M web/source.ts") : f.setRevision("b".repeat(40)); });
    assert.throws(() => releaseProduction("deploy", f), /limpo/);
    assert.equal(f.events.some(event => event[2] === "build"), false);
  }
});

test("source proof is revalidated before build and before up, without rerunning quality", () => {
  for (const failAt of [2, 3]) {
    const f = releaseFixture(); let checks = 0;
    assert.throws(() => releaseProduction("deploy", { ...f, quality: () => {
      if (++checks === failAt) throw new Error("source changed");
    } }), /source changed/);
    assert.equal(f.events.some(event => event[2] === "up"), false);
    assert.equal(f.events.some(event => event[2] === "build"), failAt === 3);
  }
});

test("Compose failure stops build and deploy; invalid mode never calls Docker", () => {
  const f = releaseFixture(); f.setDocker(() => { throw new Error("Compose invalid"); });
  assert.throws(() => releaseProduction("deploy", f), /Compose invalid/);
  assert.equal(f.events.some(event => event[2] === "build"), false);
  assert.throws(() => releaseProduction("other", f), /Uso/);
});
