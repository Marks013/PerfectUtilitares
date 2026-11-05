import assert from "node:assert/strict";
import test from "node:test";
import { readPythonPins, auditPythonPins } from "./audit-python-locks.mjs";

test("reads exact pins and hashes without accepting unpinned requirements", () => {
  assert.deepEqual(readPythonPins("# runtime\nPillow==13.0.0 --hash=sha256:" + "a".repeat(64)), [{ name: "Pillow", version: "13.0.0" }]);
  assert.throws(() => readPythonPins("Pillow>=12"));
  assert.throws(() => readPythonPins("# empty"));
});
test("fails closed on unavailable and incomplete advisory responses", async () => {
  const pins = [{ name: "Pillow", version: "13.0.0" }];
  await assert.rejects(auditPythonPins(pins, async () => new Response("", { status: 503 })));
  await assert.rejects(auditPythonPins(pins, async () => Response.json({ results: [] })));
  assert.deepEqual(await auditPythonPins(pins, async () => Response.json({ results: [{}] })), []);
  assert.deepEqual(await auditPythonPins(pins, async () => Response.json({ results: [{ vulns: [{ id: "GHSA-test" }] }] })), [{ ...pins[0], id: "GHSA-test" }]);
});
