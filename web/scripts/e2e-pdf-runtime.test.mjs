import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPdfWorkerImageRevision, linkPdfWorkerHeartbeat, pdfWorkerContainerArguments,
  pdfWorkerPreflightArguments, unlinkPdfWorkerHeartbeat,
} from "./e2e-pdf-runtime.mjs";

test("the E2E PDF runtime mounts only temporary storage and heartbeats, with bounded non-root resources", () => {
  const args = pdfWorkerContainerArguments({
    image: "e2e-pdf-worker", name: "e2e-unique", storageDirectory: "/tmp/task/storage",
    heartbeatDirectory: "/tmp/task/worker/data/pdf-jobs", uid: 1001, gid: 1001,
  });
  const values = flag => args.flatMap((item, index) => item === flag ? [args[index + 1]] : []);
  assert.deepEqual(values("--volume"), [
    "/tmp/task/storage:/tmp/task/storage", "/tmp/task/worker/data/pdf-jobs:/app/data/pdf-jobs",
  ]);
  assert.deepEqual(values("--network"), ["host"]);
  assert.deepEqual(values("--user"), ["1001:1001"]);
  assert.deepEqual(values("--memory"), ["1536m"]);
  assert.deepEqual(values("--pids-limit"), ["256"]);
  assert.ok(args.includes("--read-only"));
  assert.ok(values("--env").includes("DATABASE_URL"));
  assert.ok(values("--env").every(value => !value.includes("=")));
  assert.deepEqual(args.slice(-3), ["e2e-pdf-worker", "node", "/app/dist/pdf-worker.mjs"]);
  assert.throws(() => pdfWorkerContainerArguments({
    image: "e2e", name: "test", storageDirectory: "relative", heartbeatDirectory: "/tmp/task", uid: 1001, gid: 1001,
  }), /absolute/);
  assert.throws(() => pdfWorkerContainerArguments({
    image: "e2e", name: "test", storageDirectory: "/tmp/storage", heartbeatDirectory: "/tmp/task", uid: 0, gid: 0,
  }), /non-root/);
});

test("a stale worker revision fails before browser jobs and required compression tools are checked", () => {
  const revision = "a".repeat(40);
  assert.doesNotThrow(() => assertPdfWorkerImageRevision(revision, revision));
  assert.throws(() => assertPdfWorkerImageRevision("b".repeat(40), revision), /SOURCE_REVISION/);
  const preflight = pdfWorkerPreflightArguments("e2e-pdf-worker");
  assert.deepEqual(preflight.slice(0, 5), ["run", "--rm", "--network", "none", "--read-only"]);
  for (const tool of ["qpdf", "gs", "pdftoppm", "pdftotext", "python3", "pikepdf", "PIL", "jpeg-xobject-resample.py"]) {
    assert.ok(preflight.at(-1).includes(tool), tool);
  }
});

test("the host reads atomic worker heartbeats through a unique link and cleanup preserves other paths", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "e2e-pdf-heartbeat-test-"));
  const hostDirectory = path.join(directory, "host", "data", "pdf-jobs");
  const workerDirectory = path.join(directory, "worker");
  await mkdir(hostDirectory, { recursive: true });
  const hostPath = path.join(hostDirectory, "heartbeat-owned");
  try {
    const link = await linkPdfWorkerHeartbeat(hostPath, workerDirectory);
    await assert.rejects(linkPdfWorkerHeartbeat(hostPath, workerDirectory), { code: "EEXIST" });
    await writeFile(link.target + ".tmp", JSON.stringify({ revision: "current", updatedAt: "now" }));
    await rename(link.target + ".tmp", link.target);
    assert.deepEqual(JSON.parse(await readFile(hostPath, "utf8")), { revision: "current", updatedAt: "now" });
    await assert.rejects(unlinkPdfWorkerHeartbeat(hostPath, "different-target"), /refusing cleanup/);
    assert.ok(await readFile(hostPath, "utf8"));
    await unlinkPdfWorkerHeartbeat(hostPath, link.target);
    await assert.rejects(readFile(hostPath), { code: "ENOENT" });
    await writeFile(hostPath, "preserve");
    await assert.rejects(linkPdfWorkerHeartbeat(hostPath, workerDirectory), { code: "EEXIST" });
    assert.equal(await readFile(hostPath, "utf8"), "preserve");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
