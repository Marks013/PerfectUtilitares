import assert from "node:assert/strict";
import test from "node:test";
import { assertRunningRevision, productionServices } from "./docker-production.mjs";

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
